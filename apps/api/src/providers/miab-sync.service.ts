import { type Db, GoogleSyncStatus, type Prisma } from "@crm/db";
import { ProviderCapabilityError, withPrincipal } from "@crm/db/security";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type {
	MiabFetchedMessage,
	MiabProtocolClient,
} from "./miab-imap.client";
import { TlsMiabProtocolClient } from "./miab-imap.client";
import type { MiabCredentialSource } from "./provider-credentials";
import {
	EnvironmentMiabCredentialSource,
	providerErrorCode,
} from "./provider-credentials";

export const MIAB_CREDENTIAL_SOURCE = Symbol("MIAB_CREDENTIAL_SOURCE");
export const MIAB_PROTOCOL_FACTORY = Symbol("MIAB_PROTOCOL_FACTORY");
const LEASE_MS = 300_000;

type MiabFactory = () => MiabProtocolClient;

@Injectable()
export class MiabSyncService {
	private readonly logger = new Logger(MiabSyncService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(MIAB_CREDENTIAL_SOURCE)
		private readonly credentials: MiabCredentialSource,
		@Inject(MIAB_PROTOCOL_FACTORY) private readonly createClient: MiabFactory,
	) {}

	async runMailbox(mailboxId: string, workerId: string) {
		const context = await withPrincipal(
			this.db,
			{ userId: null, mailboxId, kind: "worker" },
			async (tx) => {
				const capability = await tx.providerCapability.findUnique({
					where: { key: "MIAB_IMAP" },
					select: { status: true },
				});
				const mailbox = await tx.mailbox.findUnique({
					where: { id: mailboxId },
					select: { id: true, address: true, status: true },
				});
				const sync = await tx.mailboxSync.findUnique({
					where: { mailboxId_source: { mailboxId, source: "miab" } },
				});
				if (capability?.status !== "VERIFIED" || mailbox?.status !== "VERIFIED")
					throw new ProviderCapabilityError(
						"MIAB_IMAP",
						"MIAB_IMAP is not verified",
					);
				if (!sync || !mailbox) throw new Error("MIAB_SYNC_NOT_CONFIGURED");
				return { mailbox, sync };
			},
		);

		const now = new Date();
		const claimed = await this.db.mailboxSync.updateMany({
			where: {
				id: context.sync.id,
				updatedAt: context.sync.updatedAt,
				OR: [{ retryAfter: null }, { retryAfter: { lte: now } }],
			},
			data: {
				status: GoogleSyncStatus.RUNNING,
				leaseOwner: workerId,
				retryAfter: new Date(now.getTime() + LEASE_MS),
				attemptCount: { increment: 1 },
				lastError: null,
				lastErrorCode: null,
			},
		});
		if (claimed.count !== 1) return { status: "leased" as const, stored: 0 };

		let client: MiabProtocolClient | null = null;
		try {
			const secret = await this.credentials.load(context.mailbox.address);
			client = this.createClient();
			await client.connect(secret);
			const [capabilities, folders] = await Promise.all([
				client.capabilities(),
				client.folders(),
			]);
			if (
				!capabilities.some((value) => /IMAP4/i.test(value)) ||
				!folders.some((value) => value.toUpperCase() === "INBOX")
			)
				throw new Error("MIAB_PROTOCOL_REQUIREMENTS_MISSING");
			const cursor = parseCursor(context.sync.cursor);
			const messages = await client.fetchReadOnly("INBOX", cursor, 50);
			const stored = await this.store(
				mailboxId,
				context.sync.userId,
				context.mailbox.address,
				messages,
			);
			const nextCursor = messages.reduce(
				(maximum, message) => Math.max(maximum, message.uid),
				cursor ?? 0,
			);
			await this.db.mailboxSync.updateMany({
				where: { id: context.sync.id, leaseOwner: workerId },
				data: {
					status: GoogleSyncStatus.IDLE,
					cursor: String(nextCursor),
					lastSyncedAt: new Date(),
					retryAfter: null,
					leaseOwner: null,
					lastError: null,
					lastErrorCode: null,
				},
			});
			this.logger.log({
				message: "MIAB mailbox sync completed",
				mailboxId,
				stored,
				cursor: nextCursor,
			});
			return { status: "synced" as const, stored, cursor: nextCursor };
		} catch (error) {
			const code = providerErrorCode(error);
			const retryMs = Math.min(
				3_600_000,
				15_000 * 2 ** Math.min(context.sync.attemptCount, 8),
			);
			await this.db.mailboxSync.updateMany({
				where: { id: context.sync.id, leaseOwner: workerId },
				data: {
					status: GoogleSyncStatus.FAILED,
					retryAfter: new Date(Date.now() + retryMs),
					leaseOwner: null,
					lastError: code,
					lastErrorCode: code,
				},
			});
			await this.db.securityAuditEvent.create({
				data: {
					actorUserId: null,
					action: "MIAB_SYNC_FAILED",
					resourceType: "Mailbox",
					resourceId: mailboxId,
					outcome: "DENIED",
					metadata: { code },
				},
			});
			this.logger.warn({
				message: "MIAB mailbox sync failed",
				mailboxId,
				code,
			});
			throw new Error(code);
		} finally {
			await client?.close().catch(() => undefined);
		}
	}

	private store(
		mailboxId: string,
		userId: string,
		mailboxAddress: string,
		messages: MiabFetchedMessage[],
	) {
		return withPrincipal(
			this.db,
			{ userId: null, mailboxId, kind: "worker" },
			async (tx) => {
				let stored = 0;
				for (const message of messages) {
					const rfcMessageId = normalizeMessageId(message.messageId);
					const exists = await tx.emailMessage.findUnique({
						where: { mailboxId_rfcMessageId: { mailboxId, rfcMessageId } },
						select: { id: true },
					});
					if (exists) continue;
					const rootMessageId = normalizeMessageId(
						message.references[0] ?? message.inReplyTo ?? message.messageId,
					);
					const thread = await upsertThread(
						tx,
						mailboxId,
						rootMessageId,
						message,
					);
					await tx.emailMessage.create({
						data: {
							mailboxId,
							threadId: thread.id,
							rfcMessageId,
							syncedByUserId: userId,
							direction:
								message.from.email === mailboxAddress.toLowerCase()
									? "OUTBOUND"
									: "INBOUND",
							fromEmail: message.from.email,
							fromName: message.from.name,
							recipients: message.recipients,
							subject: message.subject,
							snippet:
								message.body.replace(/\s+/g, " ").trim().slice(0, 240) || null,
							body: message.body,
							sentAt: message.sentAt,
						},
					});
					await tx.emailThread.update({
						where: { id: thread.id },
						data: {
							messageCount: { increment: 1 },
							firstMessageAt:
								message.sentAt < thread.firstMessageAt
									? message.sentAt
									: thread.firstMessageAt,
							lastMessageAt:
								message.sentAt > thread.lastMessageAt
									? message.sentAt
									: thread.lastMessageAt,
						},
					});
					stored += 1;
				}
				return stored;
			},
		);
	}
}

async function upsertThread(
	tx: Prisma.TransactionClient,
	mailboxId: string,
	rootMessageId: string,
	message: MiabFetchedMessage,
) {
	return tx.emailThread.upsert({
		where: { mailboxId_rootMessageId: { mailboxId, rootMessageId } },
		create: {
			mailboxId,
			rootMessageId,
			subject: message.subject,
			firstMessageAt: message.sentAt,
			lastMessageAt: message.sentAt,
			messageCount: 0,
		},
		update: {},
		select: { id: true, firstMessageAt: true, lastMessageAt: true },
	});
}

function normalizeMessageId(value: string): string {
	return value.trim().toLowerCase();
}

function parseCursor(value: string | null): number | null {
	if (!value) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export const defaultMiabProviders = [
	{
		provide: MIAB_CREDENTIAL_SOURCE,
		useClass: EnvironmentMiabCredentialSource,
	},
	{
		provide: MIAB_PROTOCOL_FACTORY,
		useValue: () => new TlsMiabProtocolClient(),
	},
];
