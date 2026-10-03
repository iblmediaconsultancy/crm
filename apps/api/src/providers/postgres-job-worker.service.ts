import { sendSystemEmail } from "@crm/auth";
import {
	ActivityType,
	type Db,
	isPersonProtected,
	isProtectedPlayerContact,
	validateExternalCopy,
} from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { snippetOf } from "../mailbox/message-text";
import { resolveAtlasOutreachSender } from "./atlas-sender";
import { standardColdFollowUpDueDates } from "./follow-up-cadence";
import {
	localProviderDoubleEnabled,
	localResendCredentialSource,
	localResendTransport,
} from "./local-provider-double";
import { MiabSentSyncService } from "./miab-sent-sync.service";
import {
	atlasLiveOutreachEnvironmentEnabled,
	atlasScheduledExecutionEnabled,
} from "./outreach-execution-gates";
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
	"  \"leasedUntil\" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '60 seconds',",
	'  "attemptCount" = "attemptCount" + 1, "updatedAt" = NOW()',
	'WHERE "id" = (',
	'  SELECT "id" FROM "systemEmailJob"',
	"  WHERE \"status\" IN ('PENDING', 'FAILED', 'LEASED')",
	'    AND ("retryAt" IS NULL OR "retryAt" <= (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\'))',
	'    AND ("leasedUntil" IS NULL OR "leasedUntil" <= (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\'))',
	'    AND "attemptCount" < "maxAttempts"',
	'  ORDER BY "createdAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1',
	")",
	'RETURNING "id", "kind", "actorUserId", "recipientEmail",',
	'  "subject", "textBody", "idempotencyKey", "attemptCount"',
].join("\n");

export const CLAIM_OUTBOUND = [
	'UPDATE "outboundDelivery"',
	'SET "status" = \'SENDING\', "leaseOwner" = $1,',
	"  \"leasedUntil\" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '60 seconds',",
	'  "attemptCount" = "attemptCount" + 1, "updatedAt" = NOW()',
	'WHERE "id" = (',
	'  SELECT od."id" FROM "outboundDelivery" od',
	'  JOIN "draft" d ON d."id" = od."draftId"',
	"  WHERE od.\"status\" IN ('PENDING', 'RETRY', 'SENDING')",
	'    AND (od."retryAt" IS NULL OR od."retryAt" <= (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\'))',
	'    AND (od."leasedUntil" IS NULL OR od."leasedUntil" <= (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\'))',
	'    AND od."attemptCount" < 5',
	'    AND ($4::boolean OR EXISTS (SELECT 1 FROM "providerCapability" pc WHERE pc."key" = \'RESEND_OUTBOUND\' AND pc."status" = \'VERIFIED\'))',
	'    AND (d."coldOutreach" = false OR (',
	"      $2::boolean",
	'      AND d."atlasAuthorizedAt" IS NOT NULL',
	'      AND EXISTS (SELECT 1 FROM "outreachAuthorization" a WHERE a."id" = d."authorizationId" AND a."scope" = \'STANDARD_COLD_OUTREACH\' AND a."status" = \'ACTIVE\' AND (a."expiresAt" IS NULL OR a."expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')))',
	'      AND EXISTS (SELECT 1 FROM "appSetting" s WHERE s."id" = \'app\' AND s."atlasLiveOutreachEnabled" = true)',
	"      AND (od.\"idempotencyKey\" NOT LIKE 'followup-delivery:%' OR $3::boolean)",
	"    ))",
	'  ORDER BY od."createdAt", od."id" FOR UPDATE OF od SKIP LOCKED LIMIT 1',
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
		@Optional() private readonly sentSync?: MiabSentSyncService,
	) {}

	async runDue(workerId: string): Promise<number> {
		let processed = 0;
		let outboundProcessed = false;
		for (let index = 0; index < 25; index += 1) {
			if (await this.processSystemEmail(workerId)) {
				processed += 1;
				continue;
			}
			const outboundId = outboundProcessed
				? null
				: await this.processOutbound(workerId);
			if (outboundId) {
				outboundProcessed = true;
				processed += 1;
				continue;
			}
			if (!(await this.processSentSync(workerId))) break;
			processed += 1;
		}
		return processed;
	}

	private async processSentSync(workerId: string): Promise<boolean> {
		return this.sentSync ? this.sentSync.runNext(workerId) : false;
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

	private async processOutbound(workerId: string): Promise<string | null> {
		const liveOutreachEnabled = atlasLiveOutreachEnvironmentEnabled();
		const scheduledExecutionEnabled = atlasScheduledExecutionEnabled();
		const localProviderDouble = localProviderDoubleEnabled();
		const rows = await withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			(tx) =>
				tx.$queryRawUnsafe<ClaimedDelivery[]>(
					CLAIM_OUTBOUND,
					workerId,
					liveOutreachEnabled,
					scheduledExecutionEnabled,
					localProviderDouble,
				),
		);
		const delivery = rows[0];
		if (!delivery) return null;
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
							createdAt: true,
							atlasAuthorizedAt: true,
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
							authorization: {
								select: { scope: true, status: true, expiresAt: true },
							},
							recipientRoute: {
								select: {
									id: true,
									type: true,
									normalizedValue: true,
									contact: {
										select: {
											id: true,
											firstName: true,
											lastName: true,
											lifecycleState: true,
											outreachState: true,
											companyId: true,
										},
									},
								},
							},
							lead: {
								select: {
									id: true,
									stage: true,
									companyId: true,
									version: true,
								},
							},
						},
					});
					const consent = draft.recipientRoute
						? await tx.contactRouteConsent.findUnique({
								where: { routeId: draft.recipientRoute.id },
								select: { status: true },
							})
						: null;
					const routeDomain = draft.recipientRoute?.normalizedValue
						?.trim()
						.toLowerCase()
						.split("@")
						.at(-1);
					const suppressedOrganization = routeDomain
						? await tx.suppressedDomain.findUnique({
								where: { domain: routeDomain },
								select: { domain: true },
							})
						: null;
					const protectedPlayer = draft.recipientRoute?.contact
						? await isProtectedPlayerContact(
								tx,
								draft.recipientRoute.contact.id,
								`${draft.recipientRoute.contact.firstName} ${draft.recipientRoute.contact.lastName ?? ""}`,
							)
						: false;
					const personProtected = draft.recipientRoute?.contact
						? await isPersonProtected(tx, draft.recipientRoute.contact.id)
						: false;
					const activeLinkedInConversation = draft.recipientRoute?.contact
						? await tx.channelEngagementState.findFirst({
								where: {
									contactId: draft.recipientRoute.contact.id,
									channel: "LINKEDIN",
									status: { in: ["ACTIVE_HUMAN_CONVERSATION", "NEEDS_IHSAN"] },
								},
								select: { id: true },
							})
						: null;
					const sharedSuppression = draft.recipientRoute?.contact
						? await tx.outreachSuppression.findFirst({
								where: {
									OR: [
										{
											scope: "CONTACT",
											contactId: draft.recipientRoute.contact.id,
										},
										{
											scope: "ROUTE",
											contactId: draft.recipientRoute.contact.id,
											channel: "EMAIL",
										},
										...(draft.recipientRoute.contact.companyId
											? [
													{
														scope: "ORGANIZATION" as const,
														companyId: draft.recipientRoute.contact.companyId,
													},
												]
											: []),
									],
								},
								select: { id: true },
							})
						: null;
					const organizationProtection = draft.coldOutreach
						? await tx.organizationProtection.findFirst({
								where: {
									companyId:
										draft.recipientRoute?.contact?.companyId ??
										draft.lead?.companyId ??
										"",
									status: "ACTIVE",
								},
								select: { id: true },
							})
						: null;
					const settings = draft.coldOutreach
						? await tx.appSetting.findUnique({
								where: { id: "app" },
								select: {
									atlasLiveOutreachEnabled: true,
									atlasWorkingTimeZone: true,
								},
							})
						: null;
					const authorizationValid =
						!draft.coldOutreach ||
						(Boolean(draft.atlasAuthorizedAt) &&
							draft.authorization?.scope === "STANDARD_COLD_OUTREACH" &&
							draft.authorization.status === "ACTIVE" &&
							(draft.authorization.expiresAt === null ||
								draft.authorization.expiresAt > new Date()) &&
							settings?.atlasLiveOutreachEnabled === true &&
							atlasLiveOutreachEnvironmentEnabled());
					const senderValid =
						!draft.coldOutreach ||
						draft.mailbox?.address.toLowerCase() === "outreach@iblmedia.com";
					if (
						draft.status !== "QUEUED" ||
						draft.recipientRoute?.type !== "EMAIL" ||
						draft.recipientRoute.contact?.lifecycleState !== "ACTIVE" ||
						personProtected ||
						(draft.coldOutreach &&
							draft.recipientRoute.contact?.outreachState !== "ALLOWED") ||
						protectedPlayer ||
						activeLinkedInConversation ||
						organizationProtection ||
						sharedSuppression ||
						consent?.status === "DO_NOT_CONTACT" ||
						(draft.coldOutreach && suppressedOrganization) ||
						!authorizationValid ||
						!senderValid
					) {
						const lastErrorCode = personProtected
							? "PERSON_OWNER_PROTECTED"
							: protectedPlayer
								? "OUTBOUND_PROTECTED_PLAYER"
								: draft.coldOutreach &&
										draft.recipientRoute?.contact?.outreachState !== "ALLOWED"
									? "OUTBOUND_CONTACT_SUPPRESSED"
									: activeLinkedInConversation
										? "OUTBOUND_LINKEDIN_CONVERSATION_ACTIVE"
										: organizationProtection
											? "OUTBOUND_ORGANIZATION_OWNER_PROTECTED"
											: sharedSuppression
												? "OUTBOUND_SHARED_SUPPRESSION"
												: consent?.status === "DO_NOT_CONTACT"
													? "OUTBOUND_ROUTE_DO_NOT_CONTACT"
													: draft.coldOutreach && suppressedOrganization
														? "OUTBOUND_ORGANIZATION_SUPPRESSED"
														: !senderValid
															? "OUTBOUND_ATLAS_SENDER_REJECTED"
															: !authorizationValid
																? "OUTBOUND_ATLAS_AUTHORIZATION_REQUIRED"
																: "OUTBOUND_CANCELLED_BY_POLICY";
						await tx.outboundDelivery.update({
							where: { id: delivery.id },
							data: {
								status: "CANCELLED",
								leaseOwner: null,
								leasedUntil: null,
								lastErrorCode,
							},
						});
						await tx.draft.update({
							where: { id: draft.id },
							data: { status: "CANCELLED" },
						});
						if (draft.coldOutreach) {
							await tx.outreachQuota.updateMany({
								where: {
									day: dayKey(
										draft.createdAt,
										settings?.atlasWorkingTimeZone ?? "Europe/Amsterdam",
									),
									coldEmailReserved: { gt: 0 },
								},
								data: { coldEmailReserved: { decrement: 1 } },
							});
						}
						return null;
					}
					return draft;
				},
			);
			if (!prepared) return delivery.id;
			const preparedMailboxId = prepared.mailboxId;
			const preparedMailbox =
				prepared.mailbox ??
				(preparedMailboxId
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
			if (!preparedMailbox) throw new Error("OUTBOUND_MAILBOX_MISSING");
			const copyValidation = validateExternalCopy(prepared);
			if (!copyValidation.valid) throw new Error(copyValidation.reason);
			const secret = await this.credentials.load();
			const configuredSender = resolveAtlasOutreachSender();
			const outboundMessageId = `<ibl-${prepared.id}@iblmedia.com>`;
			const sent = await this.transport.send(secret.apiKey, {
				from: {
					address: configuredSender.address,
					displayName: configuredSender.displayName,
				},
				to: prepared.recipientRoute?.normalizedValue ?? "",
				subject: prepared.subject ?? "",
				text: prepared.body,
				idempotencyKey: `ibl-outbound:${prepared.id}`,
				messageId: outboundMessageId,
			});
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
							sentSyncStatus: "PENDING",
							sentSyncRetryAt: null,
							sentSyncErrorCode: null,
							sentSyncLeaseOwner: null,
							sentSyncLeasedUntil: null,
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
					const thread = await tx.emailThread.upsert({
						where: {
							mailboxId_rootMessageId: {
								mailboxId: preparedMailbox.id,
								rootMessageId: outboundMessageId,
							},
						},
						create: {
							mailboxId: preparedMailbox.id,
							rootMessageId: outboundMessageId,
							subject: prepared.subject,
							companyId:
								prepared.recipientRoute?.contact?.companyId ??
								prepared.lead?.companyId ??
								null,
							contactId: prepared.recipientRoute?.contact?.id ?? null,
							leadId: prepared.lead?.id ?? null,
							firstMessageAt: sentAt,
							lastMessageAt: sentAt,
							messageCount: 0,
						},
						update: {},
						select: { id: true },
					});
					await tx.emailMessage.upsert({
						where: {
							mailboxId_rfcMessageId: {
								mailboxId: preparedMailbox.id,
								rfcMessageId: outboundMessageId,
							},
						},
						create: {
							threadId: thread.id,
							mailboxId: preparedMailbox.id,
							rfcMessageId: outboundMessageId,
							syncedByUserId: prepared.ownerUserId,
							direction: "OUTBOUND",
							fromEmail: configuredSender.address,
							fromName: configuredSender.displayName,
							recipients: [
								{
									email: prepared.recipientRoute?.normalizedValue ?? "",
									name: null,
									kind: "to",
								},
							],
							subject: prepared.subject,
							snippet: snippetOf(prepared.body),
							body: prepared.body,
							sentAt,
						},
						update: {},
						select: { id: true },
					});
					const stats = await tx.emailMessage.aggregate({
						where: { threadId: thread.id },
						_count: { _all: true },
						_min: { sentAt: true },
						_max: { sentAt: true },
					});
					await tx.emailThread.update({
						where: { id: thread.id },
						data: {
							messageCount: stats._count._all,
							firstMessageAt: stats._min.sentAt ?? sentAt,
							lastMessageAt: stats._max.sentAt ?? sentAt,
						},
					});
					await tx.activity.upsert({
						where: { emailThreadId: thread.id },
						create: {
							type: ActivityType.EMAIL,
							subject: prepared.subject ?? "(no subject)",
							body: snippetOf(prepared.body),
							occurredAt: sentAt,
							companyId:
								prepared.recipientRoute?.contact?.companyId ??
								prepared.lead?.companyId ??
								null,
							contactId: prepared.recipientRoute?.contact?.id ?? null,
							leadId: prepared.lead?.id ?? null,
							createdById: prepared.ownerUserId,
							emailThreadId: thread.id,
							meta: { synced: true, source: "outbound" },
						},
						update: {
							body: snippetOf(prepared.body),
							occurredAt: sentAt,
						},
					});
					const settings = prepared.coldOutreach
						? await tx.appSetting.findUnique({
								where: { id: "app" },
								select: { atlasWorkingTimeZone: true },
							})
						: null;
					if (prepared.coldOutreach) {
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
						const contactId = prepared.recipientRoute?.contact?.id;
						if (contactId) {
							await tx.relationshipColdTouchClaim.updateMany({
								where: {
									contactId,
									channel: "EMAIL",
									status: "CLAIMED",
								},
								data: { status: "CONSUMED", consumedAt: sentAt },
							});
							await tx.channelEngagementState.upsert({
								where: { contactId_channel: { contactId, channel: "EMAIL" } },
								create: {
									contactId,
									channel: "EMAIL",
									status: "WAITING_ON_PROSPECT",
									lastOutboundAt: sentAt,
									reason: "Atlas cold email sent",
								},
								update: {
									status: "WAITING_ON_PROSPECT",
									lastOutboundAt: sentAt,
									reason: "Atlas cold email sent",
								},
							});
						}
					}
					if (prepared.lead && ["NEW", "READY"].includes(prepared.lead.stage)) {
						const [firstFollowUpAt] = standardColdFollowUpDueDates(
							sentAt,
							settings?.atlasWorkingTimeZone ?? "Europe/Amsterdam",
						);
						const updatedLead = await tx.lead.updateMany({
							where: {
								id: prepared.lead.id,
								version: prepared.lead.version,
								stage: { in: ["NEW", "READY"] },
								attentionState: "NONE",
							},
							data: {
								stage: "CONTACTED",
								stageChangedAt: sentAt,
								lastContactedAt: sentAt,
								nextActionAt: firstFollowUpAt,
								nextActionTitle: "Review for a reply or follow up",
								lastLanguage: prepared.language,
							},
						});
						if (updatedLead.count === 1)
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
						select: { id: true, planId: true, position: true },
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
						if (remaining === 0 && followUp.position === 1 && prepared.lead) {
							await tx.lead.updateMany({
								where: {
									id: prepared.lead.id,
									attentionState: "NONE",
									stage: { notIn: ["WON", "LOST"] },
								},
								data: {
									attentionState: "PARKED",
									nextActionAt: null,
									nextActionTitle: null,
									parkedUntil: null,
								},
							});
						}
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
		return delivery.id;
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
		const terminal = dead || isNonRetryableOutboundError(code);
		this.logger.warn({
			message: "Outbound delivery failed",
			deliveryId: delivery.id,
			code,
			terminal,
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
						status: terminal ? "FAILED" : "RETRY",
						leaseOwner: null,
						leasedUntil: null,
						retryAt: terminal
							? null
							: new Date(Date.now() + this.backoff(delivery.attemptCount)),
						lastErrorCode: code,
					},
				});
				if (!dead && terminal) {
					await tx.draft.updateMany({
						where: {
							id: delivery.draftId,
							status: { in: ["APPROVED", "QUEUED"] },
						},
						data: { status: "FAILED", failureCode: code },
					});
				}
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

function isNonRetryableOutboundError(code: string): boolean {
	return (
		code === "RESEND_OUTREACH_SENDER_MISMATCH" ||
		code === "RESEND_OUTREACH_SENDER_NAME_MISMATCH"
	);
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
