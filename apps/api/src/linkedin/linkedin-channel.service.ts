import {
	coldOutreachBlockReason,
	type Db,
	isPersonProtected,
	Prisma,
} from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import {
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

const ATLAS_OPERATOR_ID = "atlas-operator";
const LINKEDIN_CHANNEL = "LINKEDIN" as const;
const RELATIONSHIP_LOCK_PREFIX = "atlas-relationship:";
const DEFAULT_LINKEDIN_MESSAGE_LIMIT = 20;
const DEFAULT_LINKEDIN_CONNECTION_LIMIT = 5;

const CLAIM_NEXT_JOB = [
	'UPDATE "linkedinSendJob"',
	'SET "status" = \'LEASED\', "leaseOwner" = $1,',
	"  \"leasedUntil\" = NOW() + INTERVAL '60 seconds',",
	'  "attemptCount" = "attemptCount" + 1, "updatedAt" = NOW()',
	'WHERE "id" = (',
	'  SELECT "id" FROM "linkedinSendJob"',
	"  WHERE \"status\" IN ('PENDING', 'FAILED', 'LEASED')",
	'    AND "approvedAt" IS NOT NULL',
	'    AND ("retryAt" IS NULL OR "retryAt" <= NOW())',
	'    AND ("leasedUntil" IS NULL OR "leasedUntil" <= NOW())',
	'    AND "attemptCount" < "maxAttempts"',
	"    AND NOT EXISTS (",
	'      SELECT 1 FROM "linkedinConversation" c',
	'      JOIN "personProtection" pp ON pp."contactId" = c."contactId"',
	"        AND pp.\"status\" = 'ACTIVE'",
	'      WHERE c."id" = "linkedinSendJob"."conversationId"',
	"    )",
	'  ORDER BY "requestedAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1',
	")",
	'RETURNING "id", "conversationId", "messageId", "action", "status",',
	'  "coldOutreach", "attemptCount", "leaseOwner", "leasedUntil"',
].join("\n");

type JsonValue = Prisma.InputJsonValue;

type ConversationInput = {
	contactId: string;
	companyId?: string | null;
	leadId?: string | null;
	identityKey: string;
	profileUrl?: string | null;
	normalizedProfileUrl?: string | null;
	externalConversationKey?: string | null;
};

type QueueInput = {
	conversationId: string;
	action: "MESSAGE" | "CONNECTION_REQUEST";
	idempotencyKey: string;
	actionPayload?: JsonValue;
	body?: string;
	approvedAt: Date;
	coldOutreach?: boolean;
	accountKey?: string;
	messageLimit?: number;
	connectionLimit?: number;
};

type InboundInput = ConversationInput & {
	body: string;
	sourceKey: string;
	externalMessageKey?: string | null;
	provenance:
		| "HISTORICAL_IMPORT"
		| "VERIFIED_INBOX"
		| "WORKFLOW_EVIDENCE"
		| "MANUAL";
	direction?: "INBOUND" | "OUTBOUND";
	occurredAt?: Date | null;
	classification:
		| "ACTION_REQUIRED"
		| "REFERRAL_OR_PLAYER_OPPORTUNITY"
		| "WARM_HANDOFF"
		| "WAITING_ON_PROSPECT"
		| "POSITIVE_LIGHT"
		| "PARKED_NO_CURRENT_NEED"
		| "CLOSED_OR_DO_NOT_PUSH"
		| "AMBIGUOUS_OR_NEEDS_IHSAN";
	globalSuppression?: boolean;
	organizationWideRejection?: boolean;
};

type AttemptOutcome = {
	jobId: string;
	workerId: string;
	attemptNumber: number;
	status: "SUCCEEDED" | "FAILED" | "AMBIGUOUS" | "BLOCKED";
	externalMessageKey?: string | null;
	errorCode?: string | null;
	details?: JsonValue;
	completedAt?: Date;
};

function lockKey(contactId: string): string {
	return `${RELATIONSHIP_LOCK_PREFIX}${contactId}`;
}

function utcDay(value: Date): Date {
	return new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
	);
}

function channelStatusForClassification(
	classification: InboundInput["classification"],
):
	| "ACTIVE_HUMAN_CONVERSATION"
	| "WAITING_ON_PROSPECT"
	| "PARKED"
	| "CLOSED"
	| "NEEDS_IHSAN" {
	if (
		classification === "REFERRAL_OR_PLAYER_OPPORTUNITY" ||
		classification === "WARM_HANDOFF"
	)
		return "NEEDS_IHSAN";
	if (classification === "ACTION_REQUIRED") return "ACTIVE_HUMAN_CONVERSATION";
	if (
		classification === "WAITING_ON_PROSPECT" ||
		classification === "POSITIVE_LIGHT"
	)
		return "WAITING_ON_PROSPECT";
	if (classification === "PARKED_NO_CURRENT_NEED") return "PARKED";
	if (classification === "CLOSED_OR_DO_NOT_PUSH") return "CLOSED";
	return "NEEDS_IHSAN";
}

function conversationStatusForChannelStatus(
	status: ReturnType<typeof channelStatusForClassification>,
): "ACTIVE" | "WAITING_ON_PROSPECT" | "PARKED" | "CLOSED" | "NEEDS_IHSAN" {
	if (status === "ACTIVE_HUMAN_CONVERSATION") return "ACTIVE";
	return status;
}

function isHistorical(provenance: InboundInput["provenance"]): boolean {
	return (
		provenance === "HISTORICAL_IMPORT" || provenance === "WORKFLOW_EVIDENCE"
	);
}

@Injectable()
export class LinkedInChannelService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async ensureConversation(input: ConversationInput) {
		return withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				const contact = await tx.contact.findUnique({
					where: { id: input.contactId },
					select: { id: true, companyId: true },
				});
				if (!contact)
					throw new NotFoundException("LinkedIn contact not found.");
				if (input.leadId) {
					const lead = await tx.lead.findFirst({
						where: { id: input.leadId, contactId: input.contactId },
						select: { id: true },
					});
					if (!lead)
						throw new ConflictException(
							"LinkedIn lead does not belong to the contact.",
						);
				}
				const existingConversation = await tx.linkedInConversation.findUnique({
					where: { identityKey: input.identityKey },
					select: { contactId: true },
				});
				if (
					existingConversation &&
					existingConversation.contactId !== contact.id
				)
					throw new ConflictException(
						"LinkedIn identity is attached to another contact.",
					);
				const conversation = await tx.linkedInConversation.upsert({
					where: { identityKey: input.identityKey },
					create: {
						contactId: contact.id,
						companyId: input.companyId ?? contact.companyId,
						leadId: input.leadId ?? null,
						identityKey: input.identityKey,
						profileUrl: input.profileUrl ?? null,
						normalizedProfileUrl: input.normalizedProfileUrl ?? null,
						externalConversationKey: input.externalConversationKey ?? null,
					},
					update: {
						companyId: input.companyId ?? undefined,
						leadId: input.leadId ?? undefined,
						profileUrl: input.profileUrl ?? undefined,
						normalizedProfileUrl: input.normalizedProfileUrl ?? undefined,
						externalConversationKey: input.externalConversationKey ?? undefined,
					},
				});
				await tx.channelEngagementState.upsert({
					where: {
						contactId_channel: {
							contactId: contact.id,
							channel: LINKEDIN_CHANNEL,
						},
					},
					create: { contactId: contact.id, channel: LINKEDIN_CHANNEL },
					update: {},
				});
				return conversation;
			},
		);
	}

	async queueAction(input: QueueInput) {
		return withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				if (input.action === "MESSAGE" && !input.body?.trim())
					throw new ConflictException("A LinkedIn message body is required.");
				const conversation = await tx.linkedInConversation.findUnique({
					where: { id: input.conversationId },
					select: {
						id: true,
						contactId: true,
						companyId: true,
						leadId: true,
						status: true,
						consent: true,
					},
				});
				if (!conversation)
					throw new NotFoundException("LinkedIn conversation not found.");
				if (conversation.consent === "DO_NOT_CONTACT")
					throw new ConflictException("LinkedIn conversation is suppressed.");
				if (await isPersonProtected(tx, conversation.contactId))
					throw new ConflictException(
						"LinkedIn action blocked: PERSON_OWNER_PROTECTED.",
					);
				await tx.$executeRaw(
					Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey(conversation.contactId)}))`,
				);
				const existingJob = await tx.linkedInSendJob.findUnique({
					where: { idempotencyKey: input.idempotencyKey },
					select: { id: true, status: true, messageId: true },
				});
				if (existingJob) return existingJob;
				const [
					contact,
					lead,
					channelState,
					otherState,
					suppressions,
					claim,
					organizationProtection,
				] = await Promise.all([
					tx.contact.findUnique({
						where: { id: conversation.contactId },
						select: { outreachState: true },
					}),
					tx.lead.findUnique({
						where: { id: conversation.leadId ?? "" },
						select: {
							id: true,
							stage: true,
							attentionState: true,
							version: true,
						},
					}),
					tx.channelEngagementState.findUnique({
						where: {
							contactId_channel: {
								contactId: conversation.contactId,
								channel: LINKEDIN_CHANNEL,
							},
						},
						select: { status: true },
					}),
					tx.channelEngagementState.findFirst({
						where: {
							contactId: conversation.contactId,
							channel: { not: LINKEDIN_CHANNEL },
							status: { in: ["ACTIVE_HUMAN_CONVERSATION", "NEEDS_IHSAN"] },
						},
						select: { status: true },
					}),
					tx.outreachSuppression.findMany({
						where: {
							OR: [
								{ scope: "CONTACT", contactId: conversation.contactId },
								{
									scope: "ROUTE",
									contactId: conversation.contactId,
									channel: LINKEDIN_CHANNEL,
								},
								...(conversation.companyId
									? [
											{
												scope: "ORGANIZATION" as const,
												companyId: conversation.companyId,
											},
										]
									: []),
							],
						},
						select: { scope: true, channel: true },
					}),
					tx.relationshipColdTouchClaim.findUnique({
						where: { contactId: conversation.contactId },
						select: { status: true, idempotencyKey: true },
					}),
					tx.organizationProtection.findFirst({
						where: {
							companyId: conversation.companyId ?? "",
							status: "ACTIVE",
						},
						select: { id: true },
					}),
				]);
				if (!contact)
					throw new NotFoundException("LinkedIn contact not found.");
				if (input.coldOutreach ?? true) {
					const reason = coldOutreachBlockReason({
						contactOutreachState: contact.outreachState,
						leadAttentionState: lead?.attentionState ?? "NONE",
						channelStatus: channelState?.status ?? null,
						otherChannelStatus: otherState?.status ?? null,
						routeSuppressed: suppressions.some(
							(row) =>
								row.scope === "ROUTE" && row.channel === LINKEDIN_CHANNEL,
						),
						contactSuppressed: suppressions.some(
							(row) => row.scope === "CONTACT",
						),
						organizationSuppressed: suppressions.some(
							(row) => row.scope === "ORGANIZATION",
						),
						organizationProtected: Boolean(organizationProtection),
						firstTouchStatus: claim?.status ?? null,
					});
					if (reason && reason !== "FIRST_TOUCH_CLAIMED")
						throw new ConflictException(
							`LinkedIn cold outreach blocked: ${reason}.`,
						);
					if (
						claim &&
						claim.status !== "RELEASED" &&
						claim.idempotencyKey !== input.idempotencyKey
					)
						throw new ConflictException(
							"A cold first touch already exists for this contact.",
						);
					if (!claim) {
						await tx.relationshipColdTouchClaim.create({
							data: {
								contactId: conversation.contactId,
								leadId: conversation.leadId,
								channel: LINKEDIN_CHANNEL,
								idempotencyKey: input.idempotencyKey,
							},
						});
					} else if (claim.status === "RELEASED") {
						await tx.relationshipColdTouchClaim.update({
							where: { contactId: conversation.contactId },
							data: {
								channel: LINKEDIN_CHANNEL,
								status: "CLAIMED",
								idempotencyKey: input.idempotencyKey,
								claimedAt: new Date(),
								releasedAt: null,
								consumedAt: null,
							},
						});
					}
				}
				const accountKey = input.accountKey?.trim() || "default";
				const quotaDay = utcDay(new Date());
				const messageLimit = Math.max(
					1,
					input.messageLimit ?? DEFAULT_LINKEDIN_MESSAGE_LIMIT,
				);
				const connectionLimit = Math.max(
					1,
					input.connectionLimit ?? DEFAULT_LINKEDIN_CONNECTION_LIMIT,
				);
				await tx.linkedInQuota.upsert({
					where: { day_accountKey: { day: quotaDay, accountKey } },
					create: {
						day: quotaDay,
						accountKey,
						messageLimit,
						connectionLimit,
					},
					update: {},
				});
				const quotaRows =
					input.action === "MESSAGE"
						? await tx.$queryRaw<{ id: string }[]>(
								Prisma.sql`UPDATE "linkedinQuota" SET "messageReserved" = "messageReserved" + 1, "updatedAt" = NOW() WHERE "day" = ${quotaDay} AND "accountKey" = ${accountKey} AND "messageReserved" + "messageSent" < "messageLimit" RETURNING "id"`,
							)
						: await tx.$queryRaw<{ id: string }[]>(
								Prisma.sql`UPDATE "linkedinQuota" SET "connectionReserved" = "connectionReserved" + 1, "updatedAt" = NOW() WHERE "day" = ${quotaDay} AND "accountKey" = ${accountKey} AND "connectionReserved" + "connectionSent" < "connectionLimit" RETURNING "id"`,
							);
				if (quotaRows.length === 0)
					throw new ConflictException("LinkedIn channel quota is exhausted.");
				let messageId: string | null = null;
				if (input.action === "MESSAGE") {
					const message = await tx.linkedInMessage.upsert({
						where: { idempotencyKey: `${input.idempotencyKey}:message` },
						create: {
							conversationId: conversation.id,
							direction: "OUTBOUND",
							status: "QUEUED",
							provenance: "MANUAL",
							body: input.body?.trim() ?? "",
							sourceKey: `${input.idempotencyKey}:message`,
							idempotencyKey: `${input.idempotencyKey}:message`,
							countsTowardAtlasMetrics: true,
							attributedToAtlas: true,
						},
						update: {},
						select: { id: true },
					});
					messageId = message.id;
				}
				const job = await tx.linkedInSendJob.upsert({
					where: { idempotencyKey: input.idempotencyKey },
					create: {
						conversationId: conversation.id,
						messageId,
						action: input.action,
						coldOutreach: input.coldOutreach ?? true,
						accountKey,
						quotaDay,
						idempotencyKey: input.idempotencyKey,
						actionPayload: input.actionPayload,
						approvedAt: input.approvedAt,
					},
					update: {},
					select: { id: true, status: true, messageId: true },
				});
				return job;
			},
		);
	}

	async claimNextJob(workerId: string) {
		return withPrincipal(this.db, { userId: null, kind: "worker" }, (tx) =>
			tx.$queryRawUnsafe(CLAIM_NEXT_JOB, workerId),
		);
	}

	async beginAttempt(jobId: string, workerId: string) {
		return withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				const job = await tx.linkedInSendJob.findUnique({
					where: { id: jobId },
					select: {
						status: true,
						leaseOwner: true,
						attemptCount: true,
						conversation: { select: { contactId: true } },
					},
				});
				if (job?.status !== "LEASED" || job.leaseOwner !== workerId)
					throw new ConflictException(
						"LinkedIn job lease is not owned by this worker.",
					);
				if (await isPersonProtected(tx, job.conversation.contactId))
					throw new ConflictException(
						"LinkedIn action blocked: PERSON_OWNER_PROTECTED.",
					);
				return tx.linkedInSendAttempt.create({
					data: {
						jobId,
						attemptNumber: job.attemptCount,
						browserSessionKey: workerId,
					},
				});
			},
		);
	}

	async recordAttempt(input: AttemptOutcome) {
		return withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				const job = await tx.linkedInSendJob.findUnique({
					where: { id: input.jobId },
					include: {
						message: true,
						conversation: {
							select: { id: true, contactId: true, leadId: true },
						},
					},
				});
				if (job?.status !== "LEASED" || job.leaseOwner !== input.workerId)
					throw new ConflictException(
						"LinkedIn job lease is not owned by this worker.",
					);
				const completedAt = input.completedAt ?? new Date();
				await tx.linkedInSendAttempt.update({
					where: {
						jobId_attemptNumber: {
							jobId: input.jobId,
							attemptNumber: input.attemptNumber,
						},
					},
					data: {
						status: input.status,
						externalMessageKey: input.externalMessageKey ?? null,
						errorCode: input.errorCode ?? null,
						outcome: input.details,
						completedAt,
					},
				});
				if (input.status === "SUCCEEDED") {
					if (job.messageId) {
						await tx.linkedInMessage.update({
							where: { id: job.messageId },
							data: {
								status: "SENT",
								occurredAt: completedAt,
								externalMessageKey: input.externalMessageKey ?? undefined,
							},
						});
					}
					await tx.linkedInConversation.update({
						where: { id: job.conversationId },
						data: {
							lastOutboundAt: completedAt,
							lastMessageAt: completedAt,
							status: "WAITING_ON_PROSPECT",
							classification: "WAITING_ON_PROSPECT",
							version: { increment: 1 },
						},
					});
					await tx.channelEngagementState.upsert({
						where: {
							contactId_channel: {
								contactId: job.conversation.contactId,
								channel: LINKEDIN_CHANNEL,
							},
						},
						create: {
							contactId: job.conversation.contactId,
							channel: LINKEDIN_CHANNEL,
							status: "WAITING_ON_PROSPECT",
							lastOutboundAt: completedAt,
						},
						update: {
							status: "WAITING_ON_PROSPECT",
							lastOutboundAt: completedAt,
							version: { increment: 1 },
						},
					});
					if (job.coldOutreach)
						await tx.relationshipColdTouchClaim.updateMany({
							where: {
								contactId: job.conversation.contactId,
								status: "CLAIMED",
								channel: LINKEDIN_CHANNEL,
							},
							data: { status: "CONSUMED", consumedAt: completedAt },
						});
					if (job.action === "MESSAGE")
						await tx.$executeRaw(
							Prisma.sql`UPDATE "linkedinQuota" SET "messageReserved" = GREATEST("messageReserved" - 1, 0), "messageSent" = "messageSent" + 1, "updatedAt" = NOW() WHERE "day" = ${job.quotaDay} AND "accountKey" = ${job.accountKey}`,
						);
					else
						await tx.$executeRaw(
							Prisma.sql`UPDATE "linkedinQuota" SET "connectionReserved" = GREATEST("connectionReserved" - 1, 0), "connectionSent" = "connectionSent" + 1, "updatedAt" = NOW() WHERE "day" = ${job.quotaDay} AND "accountKey" = ${job.accountKey}`,
						);
					if (job.messageId) {
						await tx.activity.upsert({
							where: { linkedinMessageId: job.messageId },
							create: {
								type: "NOTE",
								subject: "LinkedIn outbound message",
								body: job.message?.body ?? null,
								occurredAt: completedAt,
								contactId: job.conversation.contactId,
								leadId: job.conversation.leadId,
								createdById: ATLAS_OPERATOR_ID,
								linkedinMessageId: job.messageId,
								meta: {
									channel: LINKEDIN_CHANNEL,
									direction: "OUTBOUND",
									provenance: "BROWSER_CONFIRMED",
									countsTowardAtlasMetrics: true,
									attributedToAtlas: true,
								},
							},
							update: {
								body: job.message?.body ?? null,
								occurredAt: completedAt,
							},
						});
					}
					await tx.linkedInSendJob.update({
						where: { id: input.jobId },
						data: {
							status: "SUCCEEDED",
							leaseOwner: null,
							leasedUntil: null,
							retryAt: null,
							lastErrorCode: null,
						},
					});
					return { status: "SUCCEEDED" as const };
				}
				const ambiguous =
					input.status === "AMBIGUOUS" || input.status === "BLOCKED";
				if (ambiguous) {
					await tx.linkedInConversation.update({
						where: { id: job.conversationId },
						data: {
							status: "NEEDS_IHSAN",
							classification: "AMBIGUOUS_OR_NEEDS_IHSAN",
							version: { increment: 1 },
						},
					});
					await tx.channelEngagementState.upsert({
						where: {
							contactId_channel: {
								contactId: job.conversation.contactId,
								channel: LINKEDIN_CHANNEL,
							},
						},
						create: {
							contactId: job.conversation.contactId,
							channel: LINKEDIN_CHANNEL,
							status: "NEEDS_IHSAN",
							reason: input.errorCode ?? "AMBIGUOUS_BROWSER_OUTCOME",
						},
						update: {
							status: "NEEDS_IHSAN",
							reason: input.errorCode ?? "AMBIGUOUS_BROWSER_OUTCOME",
							version: { increment: 1 },
						},
					});
				}
				if (job.messageId)
					await tx.linkedInMessage.update({
						where: { id: job.messageId },
						data: { status: ambiguous ? "AMBIGUOUS" : "FAILED" },
					});
				await tx.linkedInSendJob.update({
					where: { id: input.jobId },
					data: {
						status: ambiguous
							? input.status === "BLOCKED"
								? "WAITING_REVIEW"
								: "AMBIGUOUS"
							: "FAILED",
						leaseOwner: null,
						leasedUntil: null,
						retryAt: ambiguous ? null : new Date(Date.now() + 60_000),
						lastErrorCode: input.errorCode ?? "LINKEDIN_EXECUTION_FAILED",
					},
				});
				return {
					status: ambiguous ? ("WAITING_REVIEW" as const) : ("FAILED" as const),
				};
			},
		);
	}

	async recordInbound(input: InboundInput) {
		return withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				const contact = await tx.contact.findUnique({
					where: { id: input.contactId },
					select: { id: true, companyId: true },
				});
				if (!contact)
					throw new NotFoundException("LinkedIn contact not found.");
				await tx.$executeRaw(
					Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey(input.contactId)}))`,
				);
				const existingConversation = await tx.linkedInConversation.findUnique({
					where: { identityKey: input.identityKey },
					select: { contactId: true },
				});
				if (
					existingConversation &&
					existingConversation.contactId !== input.contactId
				)
					throw new ConflictException(
						"LinkedIn identity is attached to another contact.",
					);
				if (input.organizationWideRejection && !input.companyId)
					throw new ConflictException(
						"Organization-wide rejection requires a company identity.",
					);
				const conversation = await tx.linkedInConversation.upsert({
					where: { identityKey: input.identityKey },
					create: {
						contactId: input.contactId,
						companyId: input.companyId ?? contact.companyId,
						leadId: input.leadId ?? null,
						identityKey: input.identityKey,
						profileUrl: input.profileUrl ?? null,
						normalizedProfileUrl: input.normalizedProfileUrl ?? null,
						externalConversationKey: input.externalConversationKey ?? null,
						status: conversationStatusForChannelStatus(
							channelStatusForClassification(input.classification),
						),
						classification: input.classification,
					},
					update: {
						leadId: input.leadId ?? undefined,
						status: conversationStatusForChannelStatus(
							channelStatusForClassification(input.classification),
						),
						classification: input.classification,
						version: { increment: 1 },
					},
				});
				const occurredAt = input.occurredAt ?? new Date();
				const historical = isHistorical(input.provenance);
				const message = await tx.linkedInMessage.upsert({
					where: { sourceKey: input.sourceKey },
					create: {
						conversationId: conversation.id,
						direction: input.direction ?? "INBOUND",
						status: historical ? "HISTORICAL" : "RECEIVED",
						provenance: input.provenance,
						body: input.body,
						occurredAt,
						externalMessageKey: input.externalMessageKey ?? null,
						sourceKey: input.sourceKey,
						idempotencyKey: `linkedin-inbound:${input.sourceKey}`,
						countsTowardAtlasMetrics: false,
						attributedToAtlas: false,
					},
					update: {},
				});
				const channelStatus = channelStatusForClassification(
					input.classification,
				);
				await tx.channelEngagementState.upsert({
					where: {
						contactId_channel: {
							contactId: input.contactId,
							channel: LINKEDIN_CHANNEL,
						},
					},
					create: {
						contactId: input.contactId,
						channel: LINKEDIN_CHANNEL,
						status: channelStatus,
						lastInboundAt: occurredAt,
					},
					update: {
						status: channelStatus,
						lastInboundAt: occurredAt,
						version: { increment: 1 },
					},
				});
				await tx.linkedInConversation.update({
					where: { id: conversation.id },
					data: { lastInboundAt: occurredAt, lastMessageAt: occurredAt },
				});
				await tx.activity.upsert({
					where: { linkedinMessageId: message.id },
					create: {
						type: "NOTE",
						subject: "LinkedIn inbound message",
						body: input.body,
						occurredAt,
						contactId: input.contactId,
						companyId: input.companyId ?? contact.companyId,
						leadId: input.leadId ?? null,
						createdById: ATLAS_OPERATOR_ID,
						linkedinMessageId: message.id,
						meta: {
							channel: LINKEDIN_CHANNEL,
							direction: input.direction ?? "INBOUND",
							provenance: input.provenance,
							historical,
							countsTowardAtlasMetrics: false,
							attributedToAtlas: false,
						},
					},
					update: { body: input.body, occurredAt },
				});
				if (input.globalSuppression || input.organizationWideRejection) {
					await tx.outreachSuppression.upsert({
						where: {
							idempotencyKey: input.organizationWideRejection
								? `linkedin:organization:${input.companyId ?? input.identityKey}`
								: `linkedin:contact:${input.contactId}`,
						},
						create: {
							scope: input.organizationWideRejection
								? "ORGANIZATION"
								: "CONTACT",
							channel: null,
							normalizedKey: input.organizationWideRejection
								? (input.companyId ?? input.identityKey)
								: input.contactId,
							reason: "LinkedIn inbound suppression",
							source: "LINKEDIN_INBOUND",
							contactId: input.organizationWideRejection
								? null
								: input.contactId,
							companyId: input.organizationWideRejection
								? input.companyId
								: null,
							idempotencyKey: input.organizationWideRejection
								? `linkedin:organization:${input.companyId ?? input.identityKey}`
								: `linkedin:contact:${input.contactId}`,
						},
						update: {},
					});
				} else if (input.classification === "CLOSED_OR_DO_NOT_PUSH") {
					await tx.outreachSuppression.upsert({
						where: {
							idempotencyKey: `linkedin:route:${input.identityKey}`,
						},
						create: {
							scope: "ROUTE",
							channel: LINKEDIN_CHANNEL,
							normalizedKey: input.identityKey,
							reason: "LinkedIn contact rejected further outreach",
							source: "LINKEDIN_INBOUND",
							contactId: input.contactId,
							idempotencyKey: `linkedin:route:${input.identityKey}`,
						},
						update: {},
					});
				}
				if (
					input.leadId &&
					[
						"ACTION_REQUIRED",
						"REFERRAL_OR_PLAYER_OPPORTUNITY",
						"WARM_HANDOFF",
						"AMBIGUOUS_OR_NEEDS_IHSAN",
					].includes(input.classification)
				) {
					const currentLead = await tx.lead.findUnique({
						where: { id: input.leadId },
						select: { version: true, stage: true },
					});
					if (currentLead && !["WON", "LOST"].includes(currentLead.stage)) {
						await tx.lead.updateMany({
							where: { id: input.leadId, version: currentLead.version },
							data: {
								stage: "REPLIED",
								stageChangedAt: occurredAt,
								lastRepliedAt: occurredAt,
								attentionState:
									input.classification === "AMBIGUOUS_OR_NEEDS_IHSAN" ||
									input.classification === "REFERRAL_OR_PLAYER_OPPORTUNITY" ||
									input.classification === "WARM_HANDOFF"
										? "NEEDS_IHSAN"
										: "NONE",
								nextActionAt: new Date(),
								nextActionTitle: "Review LinkedIn relationship state",
							},
						});
					}
				}
				return { conversationId: conversation.id, messageId: message.id };
			},
		);
	}

	async releaseColdTouch(contactId: string, idempotencyKey: string) {
		return withPrincipal(this.db, { userId: null, kind: "worker" }, (tx) =>
			tx.relationshipColdTouchClaim.updateMany({
				where: {
					contactId,
					idempotencyKey,
					status: "CLAIMED",
				},
				data: { status: "RELEASED", releasedAt: new Date() },
			}),
		);
	}
}
