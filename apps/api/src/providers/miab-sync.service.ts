import { type Db, GoogleSyncStatus, type MailboxSyncModel } from "@crm/db";
import { ProviderCapabilityError, withPrincipal } from "@crm/db/security";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { runInPrincipalTransaction } from "../database/database-context";
import { ThreadWriterService } from "../mailbox/thread-writer.service";
import { AttachmentStorageService } from "./attachment-storage.service";
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
		private readonly threads: ThreadWriterService,
		private readonly attachments: AttachmentStorageService,
	) {}

	async runDue(workerId: string): Promise<number> {
		const due = await withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			(tx) =>
				tx.mailboxSync.findMany({
					where: {
						source: "miab",
						OR: [{ retryAfter: null }, { retryAfter: { lte: new Date() } }],
					},
					select: { mailboxId: true },
					orderBy: [{ retryAfter: "asc" }, { mailboxId: "asc" }],
					take: 25,
				}),
		);
		let processed = 0;
		for (const sync of due) {
			await this.runMailbox(sync.mailboxId, workerId).catch(() => undefined);
			processed += 1;
		}
		return processed;
	}

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
				if (
					capability?.status !== "VERIFIED" ||
					mailbox?.status !== "VERIFIED"
				) {
					throw new ProviderCapabilityError(
						"MIAB_IMAP",
						"MIAB_IMAP is not verified",
					);
				}
				if (!sync || !mailbox) throw new Error("MIAB_SYNC_NOT_CONFIGURED");
				return { mailbox, sync };
			},
		);
		const now = new Date();
		const claimed = await withPrincipal(
			this.db,
			{ userId: null, mailboxId, kind: "worker" },
			(tx) =>
				tx.mailboxSync.updateMany({
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
				}),
		);
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
			) {
				throw new Error("MIAB_PROTOCOL_REQUIREMENTS_MISSING");
			}
			const cursor = parseCursor(context.sync.cursor);
			const messages = await client.fetchReadOnly("INBOX", cursor, 50);
			const mimeErrors = client.drainErrors?.() ?? [];
			if (mimeErrors.length) {
				await withPrincipal(
					this.db,
					{ userId: null, mailboxId, kind: "worker" },
					async (tx) => {
						for (const failure of mimeErrors) {
							await tx.mimeIngestionError.upsert({
								where: {
									mailboxId_providerUid: {
										mailboxId,
										providerUid: String(failure.uid),
									},
								},
								create: {
									mailboxId,
									providerUid: String(failure.uid),
									errorCode: failure.errorCode,
									reprocessStatus: "FAILED",
									attemptCount: 1,
								},
								update: {
									errorCode: failure.errorCode,
									reprocessStatus: "FAILED",
									attemptCount: { increment: 1 },
								},
							});
						}
					},
				);
			}
			const stored = await this.store(
				context.sync,
				context.mailbox.address,
				messages,
			);
			const failureCursor = mimeErrors.reduce(
				(maximum, failure) => Math.max(maximum, failure.uid),
				cursor ?? 0,
			);
			const nextCursor = messages.reduce(
				(maximum, message) => Math.max(maximum, message.uid),
				failureCursor,
			);
			await withPrincipal(
				this.db,
				{ userId: null, mailboxId, kind: "worker" },
				(tx) =>
					tx.mailboxSync.updateMany({
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
					}),
			);
			this.logger.log({
				message: "MIAB mailbox sync completed",
				mailboxId,
				stored,
				mimeFailures: mimeErrors.length,
				cursor: nextCursor,
			});
			return {
				status: "synced" as const,
				stored,
				mimeFailures: mimeErrors.length,
				cursor: nextCursor,
			};
		} catch (error) {
			const code = providerErrorCode(error);
			const retryMs = Math.min(
				3_600_000,
				15_000 * 2 ** Math.min(context.sync.attemptCount, 8),
			);
			await withPrincipal(
				this.db,
				{ userId: null, mailboxId, kind: "worker" },
				async (tx) => {
					await tx.mailboxSync.updateMany({
						where: { id: context.sync.id, leaseOwner: workerId },
						data: {
							status: GoogleSyncStatus.FAILED,
							retryAfter: new Date(Date.now() + retryMs),
							leaseOwner: null,
							lastError: code,
							lastErrorCode: code,
						},
					});
					await tx.securityAuditEvent.createMany({
						data: {
							actorUserId: null,
							action: "MIAB_SYNC_FAILED",
							resourceType: "Mailbox",
							resourceId: mailboxId,
							outcome: "DENIED",
							metadata: { code },
						},
					});
				},
			);
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
		sync: MailboxSyncModel,
		mailboxAddress: string,
		messages: MiabFetchedMessage[],
	) {
		return runInPrincipalTransaction(
			this.db,
			{ userId: null, mailboxId: sync.mailboxId, kind: "worker" },
			async () => {
				const context = await this.threads.context();
				let stored = 0;
				for (const message of messages) {
					const normalizedMessageId = normalizeMessageId(message.messageId);
					const written = await this.threads.store(
						sync,
						{
							mailbox: mailboxAddress.trim().toLowerCase(),
							origin: "miab",
						},
						{
							rfcMessageId: normalizedMessageId,
							rootId: normalizeMessageId(
								message.references[0] ?? message.inReplyTo ?? message.messageId,
							),
							subject: message.subject,
							from: message.from,
							recipients: message.recipients,
							body: message.body,
							sentAt: message.sentAt,
						},
						context,
					);
					if (written) stored += 1;
					if (message.attachments.length) {
						const persisted = await this.db.emailMessage.findUnique({
							where: {
								mailboxId_rfcMessageId: {
									mailboxId: sync.mailboxId,
									rfcMessageId: normalizedMessageId,
								},
							},
							select: { id: true },
						});
						if (persisted) {
							await this.attachments.ingest(
								sync.mailboxId,
								persisted.id,
								message.attachments,
							);
						}
					}
				}
				return stored;
			},
		);
	}
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
