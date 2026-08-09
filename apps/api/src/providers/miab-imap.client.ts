import { type ConnectionOptions, connect, type TLSSocket } from "node:tls";
import type { MiabCredentials } from "./provider-credentials";

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
};

export interface MiabProtocolClient {
	connect(credentials: MiabCredentials): Promise<void>;
	capabilities(): Promise<string[]>;
	folders(): Promise<string[]>;
	fetchReadOnly(
		folder: string,
		afterUid: number | null,
		limit: number,
	): Promise<MiabFetchedMessage[]>;
	close(): Promise<void>;
}

export type TlsConnector = (options: ConnectionOptions) => TLSSocket;

const ALLOWED_COMMANDS = new Set([
	"CAPABILITY",
	"LIST",
	"EXAMINE",
	"UID",
	"LOGOUT",
	"LOGIN",
]);

export class TlsMiabProtocolClient implements MiabProtocolClient {
	private socket: TLSSocket | null = null;
	private buffer = "";
	private counter = 0;

	constructor(private readonly connector: TlsConnector = connect) {}

	async connect(credentials: MiabCredentials): Promise<void> {
		const socket = this.connector({
			host: credentials.host,
			port: credentials.port,
			servername: credentials.host,
			rejectUnauthorized: true,
		});
		this.socket = socket;
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string | Buffer) => {
			this.buffer += chunk.toString();
		});
		await new Promise<void>((resolve, reject) => {
			socket.once("secureConnect", resolve);
			socket.once("error", reject);
		});
		await this.waitFor("* OK");
		await this.command(
			`LOGIN ${quote(credentials.username)} ${quote(credentials.password)}`,
		);
	}

	async capabilities(): Promise<string[]> {
		const response = await this.command("CAPABILITY");
		return (
			response
				.match(/\* CAPABILITY ([^\r\n]+)/i)?.[1]
				?.trim()
				.split(/\s+/) ?? []
		);
	}

	async folders(): Promise<string[]> {
		const response = await this.command('LIST "" "*"');
		return [...response.matchAll(/\* LIST .*? "([^"]+)"\r?$/gim)]
			.map((match) => match[1] ?? "")
			.filter(Boolean);
	}

	async fetchReadOnly(
		folder: string,
		afterUid: number | null,
		limit: number,
	): Promise<MiabFetchedMessage[]> {
		await this.command(`EXAMINE ${quote(folder)}`);
		const search = await this.command(
			`UID SEARCH UID ${Math.max(1, (afterUid ?? 0) + 1)}:*`,
		);
		const ids = (search.match(/\* SEARCH ([0-9 ]*)/i)?.[1] ?? "")
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.map(Number)
			.filter(Number.isFinite)
			.slice(0, limit);
		const messages: MiabFetchedMessage[] = [];
		for (const uid of ids) {
			const response = await this.command(
				`UID FETCH ${uid} (UID BODY.PEEK[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES FROM TO CC SUBJECT DATE)] BODY.PEEK[TEXT]<0.65536>)`,
			);
			const parsed = parseFetch(uid, response);
			if (parsed) messages.push(parsed);
		}
		return messages;
	}

	async close(): Promise<void> {
		if (!this.socket) return;
		try {
			await this.command("LOGOUT");
		} finally {
			this.socket.destroy();
			this.socket = null;
		}
	}

	private async command(value: string): Promise<string> {
		if (!this.socket) throw new Error("IMAP_TLS_NOT_CONNECTED");
		const verb = value.trim().split(/\s+/)[0]?.toUpperCase();
		if (
			!verb ||
			!ALLOWED_COMMANDS.has(verb) ||
			(/^UID\s/i.test(value) && !/^UID (SEARCH|FETCH)\b/i.test(value))
		)
			throw new Error("IMAP_WRITE_COMMAND_DENIED");
		const tag = `I${String(++this.counter).padStart(4, "0")}`;
		this.buffer = "";
		this.socket.write(`${tag} ${value}\r\n`);
		const response = await this.waitFor(`${tag} `);
		if (!response.includes(`${tag} OK`)) throw new Error(`${verb}_FAILED`);
		return response;
	}

	private async waitFor(marker: string): Promise<string> {
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			if (this.buffer.includes(marker)) return this.buffer;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error("IMAP_TIMEOUT");
	}
}

function quote(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function parseFetch(uid: number, response: string): MiabFetchedMessage | null {
	const literals = [...response.matchAll(/\{(\d+)\}\r\n/g)];
	const headerMarker = literals[0];
	if (!headerMarker?.index) return null;
	const headerStart = headerMarker.index + headerMarker[0].length;
	const headerLength = Number(headerMarker[1]);
	const header = response.slice(headerStart, headerStart + headerLength);
	const bodyMarker = literals.find(
		(match) => (match.index ?? 0) > headerStart + headerLength,
	);
	const bodyStart =
		bodyMarker?.index === undefined
			? -1
			: bodyMarker.index + bodyMarker[0].length;
	const body =
		bodyStart < 0
			? ""
			: response.slice(bodyStart, bodyStart + Number(bodyMarker?.[1] ?? 0));
	const headers = parseHeaders(header);
	const messageId = headers.get("message-id")?.trim();
	const from = parseAddress(headers.get("from") ?? "");
	if (!messageId || !from.email) return null;
	const recipients = [
		...parseAddresses(headers.get("to") ?? "").map((address) => ({
			...address,
			kind: "to" as const,
		})),
		...parseAddresses(headers.get("cc") ?? "").map((address) => ({
			...address,
			kind: "cc" as const,
		})),
	];
	return {
		uid,
		messageId,
		inReplyTo: headers.get("in-reply-to")?.trim() ?? null,
		references: (headers.get("references")?.match(/<[^>]+>/g) ?? []).map(
			(value) => value.trim(),
		),
		from,
		recipients,
		subject: headers.get("subject")?.trim() || null,
		body,
		sentAt: validDate(headers.get("date")),
	};
}

function parseHeaders(value: string): Map<string, string> {
	const unfolded = value.replace(/\r?\n[\t ]+/g, " ");
	const headers = new Map<string, string>();
	for (const line of unfolded.split(/\r?\n/)) {
		const separator = line.indexOf(":");
		if (separator > 0)
			headers.set(
				line.slice(0, separator).toLowerCase(),
				line.slice(separator + 1).trim(),
			);
	}
	return headers;
}

function parseAddresses(
	value: string,
): Array<{ email: string; name: string | null }> {
	return value
		.split(",")
		.map(parseAddress)
		.filter((address) => address.email.length > 0);
}

function parseAddress(value: string): { email: string; name: string | null } {
	const named = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(value);
	const email = (named?.[2] ?? value).trim().toLowerCase();
	return {
		email: /^[^\s@]+@[^\s@]+$/.test(email) ? email : "",
		name: named?.[1]?.trim() || null,
	};
}

function validDate(value: string | undefined): Date {
	const date = value ? new Date(value) : new Date();
	return Number.isNaN(date.getTime()) ? new Date() : date;
}
