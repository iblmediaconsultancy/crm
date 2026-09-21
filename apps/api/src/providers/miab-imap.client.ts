import { ImapFlow } from "imapflow";
import PostalMime from "postal-mime";
import type { MiabCredentials } from "./provider-credentials";

const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const MAX_BODY_CHARS = 2 * 1024 * 1024;

export type MiabAttachment = {
	filename: string | null;
	contentType: string;
	disposition: "attachment" | "inline";
	contentId: string | null;
	size: number;
	content: Uint8Array;
};

export type MiabFetchedMessage = {
	uid: number;
	messageId: string;
	inReplyTo: string | null;
	references: string[];
	from: { email: string; name: string | null };
	recipients: Array<{ email: string; name: string | null; kind: "to" | "cc" }>;
	subject: string | null;
	body: string;
	sentAt: Date;
	attachments: MiabAttachment[];
};

export type MiabParseError = { uid: number; errorCode: string };

export interface MiabProtocolClient {
	connect(credentials: MiabCredentials): Promise<void>;
	capabilities(): Promise<string[]>;
	folders(): Promise<string[]>;
	hasMessageId(folder: string, messageId: string): Promise<boolean>;
	append(folder: string, source: Uint8Array, internalDate: Date): Promise<number | null>;
	fetchReadOnly(folder: string, afterUid: number | null, limit: number): Promise<MiabFetchedMessage[]>;
	drainErrors?(): MiabParseError[];
	close(): Promise<void>;
}

export class TlsMiabProtocolClient implements MiabProtocolClient {
	private client: ImapFlow | null = null;
	private parseErrors: MiabParseError[] = [];

	async connect(credentials: MiabCredentials): Promise<void> {
		this.client = new ImapFlow({
			host: credentials.host,
			port: credentials.port,
			secure: true,
			auth: { user: credentials.username, pass: credentials.password },
			tls: { rejectUnauthorized: true, servername: credentials.host },
			logger: false,
			disableAutoIdle: true,
		});
		await this.client.connect();
	}

	async capabilities(): Promise<string[]> {
		return [...this.requireClient().capabilities.keys()];
	}

	async folders(): Promise<string[]> {
		return (await this.requireClient().list()).map((folder) => folder.path);
	}

	async hasMessageId(folder: string, messageId: string): Promise<boolean> {
		const client = this.requireClient();
		await client.mailboxOpen(folder, { readOnly: true });
		const uids = await client.search(
			{ header: { "message-id": messageId } },
			{ uid: true },
		);
		return uids.length > 0;
	}

	async append(
		folder: string,
		source: Uint8Array,
		internalDate: Date,
	): Promise<number | null> {
		const result = await this.requireClient().append(
			folder,
			Buffer.from(source),
			["\\Seen"],
			internalDate,
		);
		return typeof result.uid === "number" ? result.uid : null;
	}

	async fetchReadOnly(folder: string, afterUid: number | null, limit: number): Promise<MiabFetchedMessage[]> {
		this.parseErrors = [];
		const client = this.requireClient();
		await client.mailboxOpen(folder, { readOnly: true });
		const start = Math.max(1, (afterUid ?? 0) + 1);
		const uids = (await client.search({ uid: `${start}:*` }, { uid: true })) || [];
		const selected = uids.slice(0, Math.max(0, Math.min(limit, 100)));
		if (selected.length === 0) return [];
		const messages: MiabFetchedMessage[] = [];
		for await (const value of client.fetch(selected, { uid: true, source: { maxLength: MAX_MESSAGE_BYTES + 1 } }, { uid: true })) {
			if (!value.source || value.source.length > MAX_MESSAGE_BYTES) {
				this.parseErrors.push({ uid: value.uid, errorCode: "MIAB_MESSAGE_TOO_LARGE" });
				continue;
			}
			try {
				const parsed = await parseMimeMessage(value.uid, value.source);
				if (parsed) messages.push(parsed);
				else this.parseErrors.push({ uid: value.uid, errorCode: "MIME_REQUIRED_HEADERS_MISSING" });
			} catch (error) {
				this.parseErrors.push({ uid: value.uid, errorCode: mimeErrorCode(error) });
			}
		}
		return messages;
	}
	drainErrors(): MiabParseError[] {
		const errors = this.parseErrors;
		this.parseErrors = [];
		return errors;
	}

	async close(): Promise<void> {
		const client = this.client;
		this.client = null;
		if (!client) return;
		await client.logout().catch(() => client.close());
	}

	private requireClient(): ImapFlow {
		if (!this.client) throw new Error("IMAP_TLS_NOT_CONNECTED");
		return this.client;
	}
}

export async function parseMimeMessage(uid: number, source: Uint8Array): Promise<MiabFetchedMessage | null> {
	if (source.length > MAX_MESSAGE_BYTES) throw new Error("MIAB_MESSAGE_TOO_LARGE");
	const parsed = await PostalMime.parse(source);
	const from = addressOf(parsed.from);
	if (!parsed.messageId || !from.email) return null;
	const recipients = [
		...(parsed.to ?? []).map((address) => ({ ...addressOf(address), kind: "to" as const })),
		...(parsed.cc ?? []).map((address) => ({ ...addressOf(address), kind: "cc" as const })),
	].filter((address) => address.email.length > 0);
	const body = (parsed.text ?? htmlToText(parsed.html ?? "")).slice(0, MAX_BODY_CHARS);
	return {
		uid,
		messageId: parsed.messageId,
		inReplyTo: parsed.inReplyTo ?? null,
		references: parsed.references ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]) : [],
		from,
		recipients,
		subject: parsed.subject ?? null,
		body,
		sentAt: validDate(parsed.date),
		attachments: (parsed.attachments ?? []).map((attachment) => {
			const content = toBytes(attachment.content);
			return {
				filename: attachment.filename ?? null,
				contentType: attachment.mimeType || "application/octet-stream",
				disposition: attachment.disposition === "inline" ? "inline" : "attachment",
				contentId: attachment.contentId ?? null,
				size: content.byteLength,
				content,
			};
		}),
	};
}
function toBytes(value: string | ArrayBuffer | Uint8Array): Uint8Array {
	if (typeof value === "string") return new TextEncoder().encode(value);
	if (value instanceof Uint8Array) return value;
	return new Uint8Array(value);
}
function addressOf(value: { address?: string; name?: string } | undefined): { email: string; name: string | null } {
	return { email: value?.address?.trim().toLowerCase() ?? "", name: value?.name?.trim() || null };
}

function validDate(value: string | undefined): Date {
	const date = value ? new Date(value) : new Date();
	return Number.isNaN(date.getTime()) ? new Date() : date;
}

function htmlToText(value: string): string {
	return value.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}
function mimeErrorCode(error: unknown): string {
	const value = error instanceof Error ? error.message : "MIME_PARSE_FAILED";
	return value.replace(/[^A-Z0-9_]/gi, "_").toUpperCase().slice(0, 100) || "MIME_PARSE_FAILED";
}
