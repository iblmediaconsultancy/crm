import { sendSystemEmail } from "@crm/auth";
import type { Db } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { runInPrincipalTransaction } from "../database/database-context";
import { ThreadWriterService } from "../mailbox/thread-writer.service";
import { resolveAtlasOutreachSender } from "./atlas-sender";
import {
	localProviderDoubleEnabled,
	localResendCredentialSource,
	localResendTransport,
} from "./local-provider-double";
import type { ResendCredentialSource } from "./provider-credentials";
import {
	EnvironmentResendCredentialSource,
	providerErrorCode,
} from "./provider-credentials";
import { HttpResendTransport, type ResendTransport } from "./resend-transport";

export const WORKER_RESEND_CREDENTIAL_SOURCE = Symbol(
	"WORKER_RESEND_CREDENTIAL_SOURCE",
);
export const WORKER_RESEND_TRANSPORT = Symbol("WORKER_RESEND_TRANSPORT");

const CLAIM_SYSTEM_EMAIL = [
	'UPDATE "systemEmailJob"',
	'SET "status" = \'LEASED\', "leaseOwner" = $1,',
	"  \"leasedUntil\" = NOW() + INTERVAL '60 seconds',",
	'  "attemptCount" = "attemptCount" + 1, "updatedAt" = NOW()',
	'WHERE "id" = (',
	'  SELECT "id" FROM "systemEmailJob"',
	"  WHERE \"status\" IN ('PENDING', 'FAILED', 'LEASED')",
	'    AND ("retryAt" IS NULL OR "retryAt" <= NOW())',
	'    AND ("leasedUntil" IS NULL OR "leasedUntil" <= NOW())',
	'    AND "attemptCount" < "maxAttempts"',
	'  ORDER BY "createdAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1',
	")",
	'RETURNING "id", "kind", "actorUserId", "recipientEmail",',
	'  "subject", "textBody", "idempotencyKey", "attemptCount"',
].join("\n");

const CLAIM_OUTBOUND = [
	'UPDATE "outboundDelivery"',
	'SET "status" = \'SENDING\', "leaseOwner" = $1,',
	"  \"leasedUntil\" = NOW() + INTERVAL '60 seconds',",
	'  "attemptCount" = "attemptCount" + 1, "updatedAt" = NOW()',
	'WHERE "id" = (',
	'  SELECT "id" FROM "outboundDelivery"',
	"  WHERE \"status\" IN ('PENDING', 'RETRY', 'SENDING')",
	'    AND ("retryAt" IS NULL OR "retryAt" <= NOW())',
	'    AND ("leasedUntil" IS NULL OR "leasedUntil" <= NOW())',
	'    AND "attemptCount" < 5',
	'  ORDER BY "createdAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1',
	') RETURNING "id", "draftId", "attemptCount"',
].join("\n");

type ClaimedDelivery = { id: string; draftId: string; attemptCount: number };
type ClaimedSystemEmail = {
	id: string;
	kind: "INVITATION" | "PASSWORD_RESET";
	actorUserId: string;
	recipientEmail: string;
	subject: string;
	textBody: string;
	idempotencyKey: string;
	attemptCount: number;
};

@Injectable()
export class PostgresJobWorkerService {
	private readonly logger = new Logger(PostgresJobWorkerService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(WORKER_RESEND_CREDENTIAL_SOURCE)
		private readonly credentials: ResendCredentialSource,
		@Inject(WORKER_RESEND_TRANSPORT)
		private readonly transport: ResendTransport,
		@Optional() private readonly threadWriter?: ThreadWriterService,
	) {}

	async runDue(workerId: string): Promise<number> {
		let processed = 0;
		for (let index = 0; index < 25; index += 1) {
			const handled =
				(await this.processSystemEmail(workerId)) ||
				(await this.processOutbound(workerId));
			if (!handled) break;
			processed += 1;
		}
		return processed;
	}

	private async processSystemEmail(workerId: string): Promise<boolean> {
		const rows = await withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			(tx) =>
				tx.$queryRawUnsafe<ClaimedSystemEmail[]>(CLAIM_SYSTEM_EMAIL, workerId),
		);
		const job = rows[0];
		if (!job) return false;
		try {
			await sendSystemEmail(
				{
					actorUserId: job.actorUserId,
					to: job.recipientEmail,
					subject: job.subject,
					text: job.textBody,
					idempotencyKey: job.idempotencyKey,
					kind: job.kind,
				},
				{
					guard: async (_actorUserId) => {
						await withPrincipal(
							this.db,
							{ userId: null, kind: "worker" },
							async (tx) => {
								const capability = await tx.providerCapability.findUnique({
									where: { key: "RESEND_OUTBOUND" },
									select: { status: true },
								});
								if (capability?.status !== "VERIFIED")
									throw new Error("RESEND_OUTBOUND_UNVERIFIED");
							},
						);
					},
					credential: async () => (await this.credentials.load()).apiKey,
					transport: (apiKey, message) =>
						this.transport.send(apiKey, {
							from: parseSender(message.from),
							to: message.to,
							subject: message.subject,
							text: message.text,
							idempotencyKey: message.idempotencyKey,
						}),
					audit: async ({ actorUserId, kind, providerMessageId }) => {
						await withPrincipal(
							this.db,
							{ userId: null, kind: "worker" },
							(tx) =>
								tx.securityAuditEvent.createMany({
									data: {
										actorUserId,
										action: "SYSTEM_EMAIL_SENT",
										resourceType: "SystemEmail",
										resourceId: kind,
										outcome: "SENT",
										metadata: { providerMessageId },
									},
								}),
						);
					},
				},
			);
			await withPrincipal(this.db, { userId: null, kind: "worker" }, (tx) =>
				tx.systemEmailJob.update({
					where: { id: job.id },
					data: {
						status: "SUCCEEDED",
						leaseOwner: null,
						leasedUntil: null,
						retryAt: null,
						lastErrorCode: null,
					},
				}),
			);
		} catch (error) {
			await this.failSystemEmail(job, providerErrorCode(error));
		}
		return true;
	}

	private async processOutbound(workerId: string): Promise<boolean> {
		const rows = await withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			(tx) => tx.$queryRawUnsafe<ClaimedDelivery[]>(CLAIM_OUTBOUND, workerId),
		);
		const delivery = rows[0];
		if (!delivery) return false;
		try {
			const prepared = await withPrincipal(
				this.db,
				{ userId: null, kind: "worker" },
				async (tx) => {
					const capability = await tx.providerCapability.findUnique({
						where: { key: "RESEND_OUTBOUND" },
						select: { status: true },
					});
					if (
						!localProviderDoubleEnabled() &&
						capability?.status !== "VERIFIED"
					) {
						throw new Error("RESEND_OUTBOUND_UNVERIFIED");
					}
					const draft = await tx.draft.findUniqueOrThrow({
						where: { id: delivery.draftId },
						select: {
							id: true,
							ownerUserId: true,
							status: true,
							leadId: true,
							coldOutreach: true,
							language: true,
							subject: true,
							body: true,
							mailboxId: true,
							mailbox: {
								select: {
									id: true,
									address: true,
									displayName: true,
									ownerUserId: true,
								},
							},
							recipientRoute: {
								select: {
									id: true,
									type: true,
									normalizedValue: true,
									contact: { select: { id: true, lifecycleState: true } },
								},
							},
							lead: { select: { id: true, stage: true } },
						},
					});
					const consent = draft.recipientRoute
						? await tx.contactRouteConsent.findUnique({
								where: { routeId: draft.recipientRoute.id },
								select: { status: true },
							})
						: null;
					if (
						draft.status !== "QUEUED" ||
						draft.recipientRoute?.type !== "EMAIL" ||
						draft.recipientRoute.contact?.lifecycleState !== "ACTIVE" ||
						consent?.status === "DO_NOT_CONTACT"
					) {
						await tx.outboundDelivery.update({
							where: { id: delivery.id },
							data: {
								status: "CANCELLED",
								leaseOwner: null,
								leasedUntil: null,
								lastErrorCode: "OUTBOUND_CANCELLED_BY_POLICY",
							},
						});
						await tx.draft.update({
							where: { id: draft.id },
							data: { status: "CANCELLED" },
						});
						return null;
					}
					return draft;
				},
			);
			if (!prepared) return true;
			const preparedMailboxId = prepared.mailboxId;
			const preparedMailbox =
				prepared.mailbox ??
				(localProviderDoubleEnabled() && preparedMailboxId
					? await withPrincipal(
							this.db,
							{ userId: null, mailboxId: preparedMailboxId, kind: "worker" },
							(tx) =>
								tx.mailbox.findUnique({
									where: { id: preparedMailboxId },
									select: {
										id: true,
										address: true,
										displayName: true,
										ownerUserId: true,
									},
								}),
						)
					: null);
			const secret = await this.credentials.load();
			const configuredSender = resolveAtlasOutreachSender();
			const sent = await this.transport.send(secret.apiKey, {
				from: {
					address: configuredSender.address,
					displayName: configuredSender.displayName,
				},
				to: prepared.recipientRoute?.normalizedValue ?? "",
				subject: prepared.subject ?? "",
				text: prepared.body,
				idempotencyKey: `ibl-outbound:${prepared.id}`,
			});
			if (
				localProviderDoubleEnabled() &&
				this.threadWriter &&
				preparedMailbox
			) {
				const sentAt = new Date();
				const mailbox = preparedMailbox;
				const threadWriter = this.threadWriter;
				await runInPrincipalTransaction(
					this.db,
					{ userId: null, mailboxId: mailbox.id, kind: "worker" },
					async () =>
						threadWriter.store(
							{
								id: `local-sync-${mailbox.id}`,
								userId: mailbox.ownerUserId,
								source: "local-double",
								mailboxId: mailbox.id,
								status: "IDLE",
								cursor: null,
								lastSyncedAt: null,
								lastError: null,
								retryAfter: null,
								attemptCount: 0,
								leaseOwner: null,
								lastErrorCode: null,
								autoCreate: false,
								createdAt: sentAt,
								updatedAt: sentAt,
							},
							{
								mailbox: mailbox.address.toLowerCase(),
								origin: "legacy",
								exactContactId: prepared.recipientRoute?.contact?.id,
								projectActivity: false,
							},
							{
								rfcMessageId: `<${sent.providerMessageId}@local.invalid>`,
								rootId: sent.providerMessageId,
								subject: prepared.subject,
								from: {
									email: mailbox.address.toLowerCase(),
									name: mailbox.displayName,
								},
								recipients: [
									{
										email: prepared.recipientRoute?.normalizedValue ?? "",
										name: null,
										kind: "to",
									},
								],
								body: prepared.body,
								sentAt,
							},
						),
				);
			}
			await withPrincipal(
				this.db,
				{ userId: null, kind: "worker" },
				async (tx) => {
					const sentAt = new Date();
					await tx.outboundDelivery.update({
						where: { id: delivery.id },
						data: {
							status: "SENT",
							providerMessageId: sent.providerMessageId,
							sentAt,
							leaseOwner: null,
							leasedUntil: null,
							retryAt: null,
							lastErrorCode: null,
						},
					});
					await tx.draft.update({
						where: { id: prepared.id },
						data: { status: "SENT", sentAt },
					});
					if (prepared.coldOutreach) {
						const settings = await tx.appSetting.findUnique({
							where: { id: "app" },
							select: { atlasWorkingTimeZone: true },
						});
						const day = dayKey(
							sentAt,
							settings?.atlasWorkingTimeZone ?? "Europe/Amsterdam",
						);
						await tx.outreachQuota.updateMany({
							where: { day, coldEmailReserved: { gt: 0 } },
							data: {
								coldEmailReserved: { decrement: 1 },
								coldEmailSent: { increment: 1 },
							},
						});
					}
					if (prepared.lead && ["NEW", "READY"].includes(prepared.lead.stage)) {
						await tx.lead.update({
							where: { id: prepared.lead.id },
							data: {
								stage: "CONTACTED",
								stageChangedAt: sentAt,
								lastContactedAt: sentAt,
								nextActionAt: new Date(
									sentAt.getTime() + 3 * 24 * 60 * 60 * 1000,
								),
								nextActionTitle: "Review for a reply or follow up",
								lastLanguage: prepared.language,
							},
						});
						await tx.leadStageHistory.create({
							data: {
								leadId: prepared.lead.id,
								fromStage: prepared.lead.stage,
								toStage: "CONTACTED",
								reason: "Outbound email sent",
								actorUserId: prepared.ownerUserId,
							},
						});
					}
					const followUp = await tx.followUpStep.findFirst({
						where: { draftId: prepared.id, status: "QUEUED" },
						select: { id: true, planId: true },
					});
					if (followUp) {
						await tx.followUpStep.update({
							where: { id: followUp.id },
							data: { status: "COMPLETED", completedAt: sentAt },
						});
						const remaining = await tx.followUpStep.count({
							where: {
								planId: followUp.planId,
								status: { in: ["PENDING", "LEASED", "QUEUED"] },
							},
						});
						if (remaining === 0)
							await tx.followUpPlan.update({
								where: { id: followUp.planId },
								data: { status: "COMPLETED" },
							});
					}
				},
			);
		} catch (error) {
			this.logger.debug({
				message: "Outbound delivery diagnostic",
				deliveryId: delivery.id,
				reason: error instanceof Error ? error.message : String(error),
			});
			await this.failOutbound(delivery, providerErrorCode(error));
		}
		return true;
	}

	private failSystemEmail(job: ClaimedSystemEmail, code: string) {
		const dead = job.attemptCount >= 5;
		return withPrincipal(this.db, { userId: null, kind: "worker" }, (tx) =>
			tx.systemEmailJob.update({
				where: { id: job.id },
				data: {
					status: dead ? "DEAD" : "FAILED",
					leaseOwner: null,
					leasedUntil: null,
					retryAt: dead
						? null
						: new Date(Date.now() + this.backoff(job.attemptCount)),
					lastErrorCode: code,
				},
			}),
		);
	}

	private failOutbound(delivery: ClaimedDelivery, code: string) {
		const dead = delivery.attemptCount >= 5;
		this.logger.warn({
			message: "Outbound delivery failed",
			deliveryId: delivery.id,
			code,
			dead,
		});
		return withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				const row = await tx.outboundDelivery.findUnique({
					where: { id: delivery.id },
					select: {
						draft: { select: { coldOutreach: true, createdAt: true } },
					},
				});
				await tx.outboundDelivery.update({
					where: { id: delivery.id },
					data: {
						status: dead ? "FAILED" : "RETRY",
						leaseOwner: null,
						leasedUntil: null,
						retryAt: dead
							? null
							: new Date(Date.now() + this.backoff(delivery.attemptCount)),
						lastErrorCode: code,
					},
				});
				if (dead && row?.draft.coldOutreach) {
					const settings = await tx.appSetting.findUnique({
						where: { id: "app" },
						select: { atlasWorkingTimeZone: true },
					});
					await tx.outreachQuota.updateMany({
						where: {
							day: dayKey(
								row.draft.createdAt,
								settings?.atlasWorkingTimeZone ?? "Europe/Amsterdam",
							),
							coldEmailReserved: { gt: 0 },
						},
						data: { coldEmailReserved: { decrement: 1 } },
					});
				}
			},
		);
	}

	private backoff(attempt: number): number {
		return Math.min(3_600_000, 15_000 * 2 ** Math.min(attempt, 8));
	}
}

function parseSender(value: string): { address: string; displayName: string } {
	const match = /^(.*)\s<([^<>]+)>$/.exec(value);
	if (!match) return { address: value, displayName: "IBL Command Center" };
	return {
		address: match[2] ?? value,
		displayName: (match[1] ?? "IBL Command Center").trim(),
	};
}

function dayKey(date: Date, timeZone: string): Date {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const value = (type: string) =>
		parts.find((part) => part.type === type)?.value ?? "01";
	return new Date(
		`${value("year")}-${value("month")}-${value("day")}T00:00:00.000Z`,
	);
}
export const defaultPostgresJobProviders = [
	{
		provide: WORKER_RESEND_CREDENTIAL_SOURCE,
		useFactory: () =>
			localProviderDoubleEnabled()
				? localResendCredentialSource
				: new EnvironmentResendCredentialSource(),
	},
	{
		provide: WORKER_RESEND_TRANSPORT,
		useFactory: () =>
			localProviderDoubleEnabled()
				? localResendTransport
				: new HttpResendTransport(),
	},
];
