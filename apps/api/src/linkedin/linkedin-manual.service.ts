import {
	coldOutreachBlockReason,
	type Db,
	isPersonProtected,
	linkedInProfileRecordsMatch,
	Prisma,
} from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import {
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import type { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import { classifyLinkedInAction } from "./linkedin-action-policy";
import type { LinkedInRoutineActionInput } from "./linkedin-action-queue.service";
import { LinkedInActionQueueService } from "./linkedin-action-queue.service";
import { canReuseConsumedLinkedInConnectionClaim } from "./linkedin-first-touch";
import type {
	linkedinManualBatchInput,
	linkedinManualCompleteInput,
	linkedinManualPrepareInput,
	linkedinManualRelationshipInput,
} from "./linkedin-manual.contracts";

const LINKEDIN_CHANNEL = "LINKEDIN" as const;
const ROUTE_EVIDENCE_TTL_MS = 24 * 60 * 60 * 1000;

type PrepareInput = z.infer<typeof linkedinManualPrepareInput>;

function lockKey(contactId: string) {
	return `atlas-relationship:${contactId}`;
}

function isCold(type: PrepareInput["type"]) {
	return type === "CONNECTION_REQUEST" || type === "FIRST_MESSAGE";
}

function actionInput(
	input: PrepareInput,
	route: {
		value: string;
		normalizedValue: string;
		linkedinMemberIdentifier: string | null;
	},
): LinkedInRoutineActionInput {
	const context = {
		identityVerified: true,
		relationshipVerified: true,
		relationshipState:
			input.type === "CONNECTION_REQUEST"
				? ("NOT_CONNECTED" as const)
				: ("CONNECTED" as const),
		conversationVerified: true,
	};
	if (input.type === "CONNECTION_REQUEST")
		return {
			action: "CONNECTION_REQUEST",
			contactId: input.contactId,
			routeId: input.routeId,
			profileUrl: route.value,
			profileIdentifier: route.normalizedValue,
			context,
			idempotencyKey: input.idempotencyKey,
		};
	if (input.type === "FIRST_MESSAGE")
		return {
			action: "FIRST_MESSAGE_TO_CONNECTED_PERSON",
			contactId: input.contactId,
			routeId: input.routeId,
			profileUrl: route.value,
			profileIdentifier: route.normalizedValue,
			body: input.body ?? "",
			context,
			idempotencyKey: input.idempotencyKey,
		};
	return {
		action:
			input.type === "REPLY"
				? "ROUTINE_REPLY"
				: "EXISTING_CONVERSATION_MESSAGE",
		conversationId: input.conversationId ?? "",
		body: input.body ?? "",
		actionPayload:
			input.type === "WARM_FOLLOW_UP"
				? { legitimateReason: input.whyNow }
				: undefined,
		coldOutreach: false,
		context,
		idempotencyKey: input.idempotencyKey,
	};
}

@Injectable()
export class LinkedInManualService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly queue: LinkedInActionQueueService,
	) {}

	async list(userId: string, input: z.infer<typeof linkedinManualBatchInput>) {
		return withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			const actions = await tx.linkedInManualAction.findMany({
				where: { status: "PREPARED" },
				orderBy: [{ type: "asc" }, { createdAt: "asc" }],
				take: input.limit,
				include: {
					contact: {
						select: {
							id: true,
							firstName: true,
							lastName: true,
							company: { select: { name: true } },
						},
					},
					route: {
						select: {
							value: true,
							linkedinMemberIdentifier: true,
							linkedinRelationshipState: true,
							linkedinRelationshipVerifiedAt: true,
						},
					},
					conversation: {
						select: {
							id: true,
							status: true,
							classification: true,
							messages: {
								where: { status: { in: ["SENT", "RECEIVED", "HISTORICAL"] } },
								orderBy: { occurredAt: "desc" },
								take: 8,
								select: {
									id: true,
									direction: true,
									body: true,
									occurredAt: true,
								},
							},
						},
					},
				},
			});
			const handoffs = await tx.linkedInConversation.findMany({
				where: {
					status: "NEEDS_IHSAN",
					classification: {
						in: [
							"WARM_HANDOFF",
							"REFERRAL_OR_PLAYER_OPPORTUNITY",
							"AMBIGUOUS_OR_NEEDS_IHSAN",
						],
					},
				},
				orderBy: [{ lastInboundAt: "desc" }, { updatedAt: "desc" }],
				take: input.limit,
				select: {
					id: true,
					contactId: true,
					classification: true,
					lastInboundAt: true,
					contact: {
						select: {
							firstName: true,
							lastName: true,
							company: { select: { name: true } },
						},
					},
					messages: {
						where: { status: { in: ["SENT", "RECEIVED", "HISTORICAL"] } },
						orderBy: { occurredAt: "desc" },
						take: 6,
						select: { id: true, direction: true, body: true, occurredAt: true },
					},
				},
			});
			return { mode: "MANUAL" as const, actions, handoffs };
		});
	}

	async reconcileRelationship(
		userId: string,
		input: z.infer<typeof linkedinManualRelationshipInput>,
	) {
		const observedAt = new Date(input.observedAt);
		if (Math.abs(Date.now() - observedAt.getTime()) > 10 * 60 * 1000)
			throw new ConflictException(
				"LINKEDIN_RELATIONSHIP_OBSERVATION_NOT_FRESH",
			);
		return withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			const route = await tx.contactRoute.findFirst({
				where: {
					id: input.routeId,
					contactId: input.contactId,
					type: "LINKEDIN",
					lifecycleState: "ACTIVE",
				},
				select: {
					id: true,
					value: true,
					normalizedValue: true,
					linkedinMemberIdentifier: true,
				},
			});
			if (!route)
				throw new NotFoundException("Active LinkedIn route not found.");
			if (
				!linkedInProfileRecordsMatch(
					{
						profileUrl: route.value,
						profileIdentifier: route.normalizedValue,
						stableMemberIdentifier: route.linkedinMemberIdentifier,
					},
					{
						profileUrl: input.profileUrl,
						profileIdentifier: input.profileIdentifier,
						stableMemberIdentifier: input.stableMemberIdentifier,
					},
				)
			)
				throw new ConflictException("LINKEDIN_ROUTE_IDENTITY_CHANGED");
			await tx.$executeRaw(
				Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey(input.contactId)}))`,
			);
			const collision = await tx.contactRoute.findFirst({
				where: {
					id: { not: route.id },
					type: "LINKEDIN",
					OR: [
						{ normalizedValue: input.profileIdentifier },
						...(input.stableMemberIdentifier
							? [{ linkedinMemberIdentifier: input.stableMemberIdentifier }]
							: []),
					],
				},
				select: { id: true, contactId: true },
			});
			if (collision && collision.contactId !== input.contactId)
				throw new ConflictException("LINKEDIN_IDENTITY_ALREADY_ASSIGNED");
			const changed = await tx.contactRoute.updateMany({
				where: {
					id: route.id,
					contactId: input.contactId,
					type: "LINKEDIN",
					lifecycleState: "ACTIVE",
					value: route.value,
					normalizedValue: route.normalizedValue,
					linkedinMemberIdentifier: route.linkedinMemberIdentifier,
				},
				data: {
					linkedinRelationshipState: input.state,
					linkedinRelationshipVerifiedAt: observedAt,
					linkedinRelationshipEvidence: {
						source: "HUMAN_REPORTED_AUTHENTICATED_LINKEDIN_BROWSER_OBSERVATION",
						actorUserId: userId,
						profileUrl: input.profileUrl,
						profileIdentifier: input.profileIdentifier,
						stableMemberIdentifier: input.stableMemberIdentifier ?? null,
						state: input.state,
						observedAt: observedAt.toISOString(),
					},
					...(input.stableMemberIdentifier
						? { linkedinMemberIdentifier: input.stableMemberIdentifier }
						: {}),
				},
			});
			if (changed.count !== 1)
				throw new ConflictException(
					"LINKEDIN_ROUTE_CHANGED_DURING_RECONCILIATION",
				);
			return tx.contactRoute.findUniqueOrThrow({
				where: { id: route.id },
				select: {
					id: true,
					contactId: true,
					linkedinRelationshipState: true,
					linkedinRelationshipVerifiedAt: true,
				},
			});
		});
	}

	async prepare(userId: string, input: PrepareInput) {
		if (!input.body?.trim() && input.type !== "CONNECTION_REQUEST")
			throw new ConflictException("LINKEDIN_MANUAL_MESSAGE_REQUIRED");
		const inspected = await withPrincipal(
			this.db,
			{ userId, kind: "user" },
			async (tx) => {
				const route = await tx.contactRoute.findFirst({
					where: {
						id: input.routeId,
						contactId: input.contactId,
						type: "LINKEDIN",
						lifecycleState: "ACTIVE",
					},
					select: {
						id: true,
						value: true,
						normalizedValue: true,
						linkedinMemberIdentifier: true,
						linkedinRelationshipState: true,
						linkedinRelationshipVerifiedAt: true,
					},
				});
				if (!route)
					throw new NotFoundException("Active LinkedIn route not found.");
				return route;
			},
		);
		if (
			!inspected.linkedinRelationshipVerifiedAt ||
			Date.now() - inspected.linkedinRelationshipVerifiedAt.getTime() >
				ROUTE_EVIDENCE_TTL_MS
		)
			throw new ConflictException(
				"LINKEDIN_RELATIONSHIP_REQUIRES_FRESH_BROWSER_RECONCILIATION",
			);
		if (
			input.type === "CONNECTION_REQUEST" &&
			inspected.linkedinRelationshipState !== "NOT_CONNECTED"
		)
			throw new ConflictException(
				"LINKEDIN_CONNECTION_REQUEST_REQUIRES_VERIFIED_NOT_CONNECTED_STATE",
			);
		if (
			input.type !== "CONNECTION_REQUEST" &&
			inspected.linkedinRelationshipState !== "CONNECTED"
		)
			throw new ConflictException(
				"LINKEDIN_MESSAGE_REQUIRES_VERIFIED_CONNECTED_STATE",
			);
		const routine = actionInput(input, inspected);
		const copyPolicy = classifyLinkedInAction({
			action: routine.action,
			body: input.body,
			context: routine.context,
		});
		if (copyPolicy.classification !== "ROUTINE_AUTONOMOUS")
			throw new ConflictException(
				`${copyPolicy.classification}:${copyPolicy.reason ?? "POLICY_BLOCKED"}`,
			);
		const policy = await this.queue.inspectRoutineAction(routine);
		if (policy.classification !== "ROUTINE_AUTONOMOUS")
			throw new ConflictException(
				`${policy.classification}:${policy.reason ?? "POLICY_BLOCKED"}`,
			);
		return withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			await tx.$executeRaw(
				Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey(input.contactId)}))`,
			);
			const existing = await tx.linkedInManualAction.findUnique({
				where: { idempotencyKey: input.idempotencyKey },
			});
			if (existing) {
				if (
					existing.contactId !== input.contactId ||
					existing.routeId !== input.routeId ||
					existing.conversationId !== (input.conversationId ?? null) ||
					existing.type !== input.type ||
					existing.body !== (input.body?.trim() || null)
				)
					throw new ConflictException("LINKEDIN_MANUAL_IDEMPOTENCY_KEY_REUSED");
				return existing;
			}
			const pendingAction = await tx.linkedInManualAction.findFirst({
				where: { contactId: input.contactId, status: "PREPARED" },
				select: { id: true },
			});
			if (pendingAction)
				throw new ConflictException("LINKEDIN_MANUAL_ACTION_ALREADY_PREPARED");
			const [
				contact,
				route,
				conversation,
				protectedPerson,
				channelState,
				otherState,
				claim,
				leadAttention,
				historicalActivities,
			] = await Promise.all([
				tx.contact.findUnique({
					where: { id: input.contactId },
					select: {
						companyId: true,
						outreachState: true,
						lifecycleState: true,
					},
				}),
				tx.contactRoute.findFirst({
					where: {
						id: input.routeId,
						contactId: input.contactId,
						type: "LINKEDIN",
						lifecycleState: "ACTIVE",
					},
					select: {
						id: true,
						value: true,
						normalizedValue: true,
						linkedinMemberIdentifier: true,
						linkedinRelationshipState: true,
						linkedinRelationshipVerifiedAt: true,
					},
				}),
				input.conversationId
					? tx.linkedInConversation.findUnique({
							where: { id: input.conversationId },
							select: {
								id: true,
								contactId: true,
								profileUrl: true,
								normalizedProfileUrl: true,
								linkedinMemberIdentifier: true,
								connectionState: true,
								status: true,
								classification: true,
								consent: true,
								lastInboundAt: true,
								lastOutboundAt: true,
							},
						})
					: Promise.resolve(null),
				isPersonProtected(tx, input.contactId),
				tx.channelEngagementState.findUnique({
					where: {
						contactId_channel: {
							contactId: input.contactId,
							channel: LINKEDIN_CHANNEL,
						},
					},
					select: { status: true },
				}),
				tx.channelEngagementState.findFirst({
					where: {
						contactId: input.contactId,
						channel: { not: LINKEDIN_CHANNEL },
						status: { in: ["ACTIVE_HUMAN_CONVERSATION", "NEEDS_IHSAN"] },
					},
					select: { status: true },
				}),
				tx.relationshipColdTouchClaim.findUnique({
					where: { contactId: input.contactId },
					select: { channel: true, status: true, idempotencyKey: true },
				}),
				tx.lead.findFirst({
					where: {
						contactId: input.contactId,
						attentionState: { not: "NONE" },
					},
					orderBy: { updatedAt: "desc" },
					select: { attentionState: true },
				}),
				tx.activity.findMany({
					where: {
						contactId: input.contactId,
						type: "NOTE",
						body: { not: null },
					},
					select: { subject: true, body: true, meta: true },
				}),
			]);
			if (
				contact?.lifecycleState !== "ACTIVE" ||
				contact.outreachState !== "ALLOWED"
			)
				throw new ConflictException("LINKEDIN_CONTACT_NOT_ELIGIBLE");
			const [organizationProtection, suppressions] = await Promise.all([
				contact.companyId
					? tx.organizationProtection.findFirst({
							where: { status: "ACTIVE", companyId: contact.companyId },
							select: { id: true },
						})
					: Promise.resolve(null),
				tx.outreachSuppression.findMany({
					where: {
						OR: [
							{ scope: "CONTACT", contactId: input.contactId },
							{
								scope: "ROUTE",
								contactId: input.contactId,
								channel: LINKEDIN_CHANNEL,
							},
							...(contact.companyId
								? [
										{
											scope: "ORGANIZATION" as const,
											companyId: contact.companyId,
										},
									]
								: []),
						],
					},
					select: { scope: true, channel: true },
				}),
			]);
			if (
				!route?.linkedinRelationshipVerifiedAt ||
				Date.now() - route.linkedinRelationshipVerifiedAt.getTime() >
					ROUTE_EVIDENCE_TTL_MS ||
				route.linkedinRelationshipState !==
					(input.type === "CONNECTION_REQUEST" ? "NOT_CONNECTED" : "CONNECTED")
			)
				throw new ConflictException(
					"LINKEDIN_ROUTE_STATE_NOT_FRESH_OR_ELIGIBLE",
				);
			if (protectedPerson)
				throw new ConflictException("PERSON_OWNER_PROTECTED");
			if (organizationProtection)
				throw new ConflictException("ORGANIZATION_OWNER_PROTECTED");
			if (suppressions.length)
				throw new ConflictException("LINKEDIN_SUPPRESSION");
			if (
				channelState?.status === "NEEDS_IHSAN" ||
				otherState?.status === "NEEDS_IHSAN"
			)
				throw new ConflictException("WITH_IHSAN");
			if (input.type === "REPLY" || input.type === "WARM_FOLLOW_UP") {
				if (
					!conversation ||
					conversation.contactId !== input.contactId ||
					conversation.connectionState !== "CONNECTED"
				)
					throw new ConflictException("LINKEDIN_CONVERSATION_NOT_CONNECTED");
				if (
					conversation.status === "WAITING_ON_PROSPECT" ||
					conversation.classification === "WAITING_ON_PROSPECT"
				)
					throw new ConflictException(
						"LINKEDIN_CONVERSATION_WAITING_ON_PROSPECT",
					);
				if (
					input.type === "REPLY" &&
					(!conversation.lastInboundAt ||
						(conversation.lastOutboundAt &&
							conversation.lastInboundAt <= conversation.lastOutboundAt))
				)
					throw new ConflictException("LINKEDIN_REPLY_NOT_DUE");
				if (
					["CLOSED", "PARKED", "NEEDS_IHSAN"].includes(conversation.status) ||
					[
						"CLOSED_OR_DO_NOT_PUSH",
						"PARKED_NO_CURRENT_NEED",
						"WARM_HANDOFF",
						"AMBIGUOUS_OR_NEEDS_IHSAN",
					].includes(conversation.classification)
				)
					throw new ConflictException("LINKEDIN_CONVERSATION_NOT_ROUTINE");
				if (
					conversation.profileUrl &&
					!linkedInProfileRecordsMatch(
						{
							profileUrl: route.value,
							profileIdentifier: route.normalizedValue,
							stableMemberIdentifier: route.linkedinMemberIdentifier,
						},
						{
							profileUrl: conversation.profileUrl,
							profileIdentifier: conversation.normalizedProfileUrl,
							stableMemberIdentifier: conversation.linkedinMemberIdentifier,
						},
					)
				)
					throw new ConflictException("LINKEDIN_ROUTE_IDENTITY_CHANGED");
			} else if (input.type === "FIRST_MESSAGE" && conversation) {
				if (
					conversation.contactId !== input.contactId ||
					conversation.connectionState !== "CONNECTED"
				)
					throw new ConflictException("LINKEDIN_CONVERSATION_NOT_CONNECTED");
				if (
					["CLOSED", "PARKED", "NEEDS_IHSAN", "WAITING_ON_PROSPECT"].includes(
						conversation.status,
					) ||
					[
						"CLOSED_OR_DO_NOT_PUSH",
						"PARKED_NO_CURRENT_NEED",
						"WARM_HANDOFF",
						"AMBIGUOUS_OR_NEEDS_IHSAN",
						"WAITING_ON_PROSPECT",
					].includes(conversation.classification)
				)
					throw new ConflictException("LINKEDIN_CONVERSATION_NOT_ROUTINE");
				if (
					!conversation.profileUrl ||
					!linkedInProfileRecordsMatch(
						{
							profileUrl: route.value,
							profileIdentifier: route.normalizedValue,
							stableMemberIdentifier: route.linkedinMemberIdentifier,
						},
						{
							profileUrl: conversation.profileUrl,
							profileIdentifier: conversation.normalizedProfileUrl,
							stableMemberIdentifier: conversation.linkedinMemberIdentifier,
						},
					)
				)
					throw new ConflictException("LINKEDIN_ROUTE_IDENTITY_CHANGED");
			}
			let reusableNoNoteRequest = false;
			if (isCold(input.type)) {
				const [connectionRequest, existingMessageJob] =
					claim?.status === "CONSUMED" && claim.idempotencyKey
						? await Promise.all([
								tx.linkedInConnectionRequestJob.findUnique({
									where: { idempotencyKey: claim.idempotencyKey },
									select: { action: true, status: true, actionPayload: true },
								}),
								tx.linkedInSendJob.findUnique({
									where: { idempotencyKey: claim.idempotencyKey },
									select: { id: true },
								}),
							])
						: [null, null];
				reusableNoNoteRequest = canReuseConsumedLinkedInConnectionClaim({
					claimChannel: claim?.channel,
					claimStatus: claim?.status,
					claimIdempotencyKey: claim?.idempotencyKey,
					connectionRequest,
					messageJobExists: Boolean(existingMessageJob),
					historicalConnectionRequestActivities: historicalActivities,
				});
				const blockReason = coldOutreachBlockReason({
					contactOutreachState: contact.outreachState,
					leadAttentionState: leadAttention?.attentionState ?? "NONE",
					channelStatus: channelState?.status ?? null,
					otherChannelStatus: otherState?.status ?? null,
					routeSuppressed: false,
					contactSuppressed: false,
					organizationSuppressed: false,
					organizationProtected: false,
					firstTouchStatus: reusableNoNoteRequest
						? null
						: (claim?.status ?? null),
					personProtected: false,
				});
				if (blockReason) throw new ConflictException(blockReason);
				if (claim && claim.status !== "RELEASED" && !reusableNoNoteRequest)
					throw new ConflictException("CONTACT_ONCE_ALREADY_CLAIMED");
			}
			const action = await tx.linkedInManualAction.create({
				data: {
					contactId: input.contactId,
					routeId: input.routeId,
					profileUrl: route.value,
					normalizedProfileUrl: route.normalizedValue,
					linkedinMemberIdentifier: route.linkedinMemberIdentifier,
					conversationId: input.conversationId ?? null,
					type: input.type,
					body: input.body?.trim() || null,
					whyNow: input.whyNow,
					idempotencyKey: input.idempotencyKey,
					createdByUserId: userId,
				},
			});
			if (isCold(input.type)) {
				if (claim && (claim.status === "RELEASED" || reusableNoNoteRequest)) {
					await tx.relationshipColdTouchClaim.update({
						where: { contactId: input.contactId },
						data: {
							channel: LINKEDIN_CHANNEL,
							status: "CLAIMED",
							idempotencyKey: action.idempotencyKey,
							claimedAt: new Date(),
							releasedAt: null,
							consumedAt: null,
						},
					});
				} else {
					await tx.relationshipColdTouchClaim.create({
						data: {
							contactId: input.contactId,
							channel: LINKEDIN_CHANNEL,
							status: "CLAIMED",
							idempotencyKey: action.idempotencyKey,
						},
					});
				}
			}
			return action;
		});
	}

	async cancel(userId: string, actionId: string) {
		return withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			const action = await tx.linkedInManualAction.findUnique({
				where: { id: actionId },
				select: {
					id: true,
					contactId: true,
					type: true,
					status: true,
					idempotencyKey: true,
				},
			});
			if (!action)
				throw new NotFoundException(
					"Prepared manual LinkedIn action not found.",
				);
			if (action.status === "COMPLETED")
				throw new ConflictException(
					"A completed manual LinkedIn action cannot be cancelled.",
				);
			if (action.status === "CANCELLED") return action;
			await tx.$executeRaw(
				Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey(action.contactId)}))`,
			);
			const current = await tx.linkedInManualAction.findUnique({
				where: { id: action.id },
				select: {
					id: true,
					contactId: true,
					type: true,
					status: true,
					idempotencyKey: true,
				},
			});
			if (!current)
				throw new NotFoundException(
					"Prepared manual LinkedIn action not found.",
				);
			if (current.status === "COMPLETED")
				throw new ConflictException(
					"A completed manual LinkedIn action cannot be cancelled.",
				);
			if (current.status === "CANCELLED") return current;
			await tx.linkedInManualAction.update({
				where: { id: action.id },
				data: { status: "CANCELLED" },
			});
			if (isCold(current.type))
				await tx.relationshipColdTouchClaim.updateMany({
					where: {
						contactId: current.contactId,
						status: "CLAIMED",
						idempotencyKey: current.idempotencyKey,
					},
					data: { status: "RELEASED", releasedAt: new Date() },
				});
			return { ...current, status: "CANCELLED" as const };
		});
	}

	async complete(
		userId: string,
		input: z.infer<typeof linkedinManualCompleteInput>,
	) {
		const occurredAt = input.occurredAt
			? new Date(input.occurredAt)
			: new Date();
		return withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			let action = await tx.linkedInManualAction.findUnique({
				where: { id: input.id },
				include: {
					contact: { select: { companyId: true } },
					route: {
						select: {
							id: true,
							contactId: true,
							value: true,
							normalizedValue: true,
							linkedinMemberIdentifier: true,
							lifecycleState: true,
							linkedinRelationshipState: true,
						},
					},
					conversation: {
						select: {
							id: true,
							contactId: true,
							leadId: true,
							companyId: true,
							identityKey: true,
							profileUrl: true,
							normalizedProfileUrl: true,
							linkedinMemberIdentifier: true,
							externalConversationKey: true,
							connectionState: true,
							status: true,
							classification: true,
							lastInboundAt: true,
							version: true,
						},
					},
				},
			});
			if (!action)
				throw new NotFoundException(
					"Prepared manual LinkedIn action not found.",
				);
			if (action.status === "COMPLETED")
				return {
					actionId: action.id,
					messageId:
						(
							await tx.linkedInMessage.findUnique({
								where: { manualActionId: action.id },
								select: { id: true },
							})
						)?.id ?? null,
					activityId:
						(
							await tx.activity.findUnique({
								where: { linkedinManualActionId: action.id },
								select: { id: true },
							})
						)?.id ?? null,
					occurredAt: action.occurredAt,
				};
			if (action.status !== "PREPARED")
				throw new ConflictException("LINKEDIN_MANUAL_ACTION_NOT_PREPARED");
			await tx.$executeRaw(
				Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey(action.contactId)}))`,
			);
			action = await tx.linkedInManualAction.findUnique({
				where: { id: input.id },
				include: {
					contact: { select: { companyId: true } },
					route: {
						select: {
							id: true,
							contactId: true,
							value: true,
							normalizedValue: true,
							linkedinMemberIdentifier: true,
							lifecycleState: true,
							linkedinRelationshipState: true,
						},
					},
					conversation: {
						select: {
							id: true,
							contactId: true,
							leadId: true,
							companyId: true,
							identityKey: true,
							profileUrl: true,
							normalizedProfileUrl: true,
							linkedinMemberIdentifier: true,
							externalConversationKey: true,
							connectionState: true,
							status: true,
							classification: true,
							lastInboundAt: true,
							version: true,
						},
					},
				},
			});
			if (!action)
				throw new NotFoundException(
					"Prepared manual LinkedIn action not found.",
				);
			if (action.status === "COMPLETED")
				return {
					actionId: action.id,
					messageId:
						(
							await tx.linkedInMessage.findUnique({
								where: { manualActionId: action.id },
								select: { id: true },
							})
						)?.id ?? null,
					activityId:
						(
							await tx.activity.findUnique({
								where: { linkedinManualActionId: action.id },
								select: { id: true },
							})
						)?.id ?? null,
					occurredAt: action.occurredAt,
				};
			if (action.status !== "PREPARED")
				throw new ConflictException("LINKEDIN_MANUAL_ACTION_NOT_PREPARED");
			if (
				action.route?.lifecycleState !== "ACTIVE" ||
				action.route.contactId !== action.contactId ||
				!linkedInProfileRecordsMatch(
					{
						profileUrl: action.profileUrl,
						profileIdentifier: action.normalizedProfileUrl,
						stableMemberIdentifier: action.linkedinMemberIdentifier,
					},
					{
						profileUrl: action.route.value,
						profileIdentifier: action.route.normalizedValue,
						stableMemberIdentifier: action.route.linkedinMemberIdentifier,
					},
				)
			)
				throw new ConflictException("LINKEDIN_MANUAL_ROUTE_IDENTITY_CHANGED");
			let conversation = action.conversation;
			let messageId: string | null = null;
			if (action.type === "CONNECTION_REQUEST") {
				if (!action.route)
					throw new ConflictException("LINKEDIN_MANUAL_ROUTE_MISSING");
				await tx.contactRoute.update({
					where: { id: action.route.id },
					data: {
						linkedinRelationshipState:
							action.route.linkedinRelationshipState === "CONNECTED"
								? "CONNECTED"
								: "PENDING_SENT",
						linkedinRelationshipVerifiedAt: occurredAt,
						linkedinRelationshipEvidence: {
							source: "MANUAL_USER_CONFIRMATION",
							actionId: action.id,
							occurredAt: occurredAt.toISOString(),
						},
					},
				});
				await tx.channelEngagementState.upsert({
					where: {
						contactId_channel: {
							contactId: action.contactId,
							channel: LINKEDIN_CHANNEL,
						},
					},
					create: {
						contactId: action.contactId,
						channel: LINKEDIN_CHANNEL,
						status: "WAITING_ON_PROSPECT",
						lastOutboundAt: occurredAt,
						reason: "MANUAL_LINKEDIN_CONNECTION_REQUEST_PENDING",
					},
					update: {
						status: "WAITING_ON_PROSPECT",
						lastOutboundAt: occurredAt,
						reason: "MANUAL_LINKEDIN_CONNECTION_REQUEST_PENDING",
						version: { increment: 1 },
					},
				});
			} else {
				if (!action.route || !action.body?.trim())
					throw new ConflictException("LINKEDIN_MANUAL_MESSAGE_DATA_MISSING");
				if (!conversation) {
					conversation = await tx.linkedInConversation.upsert({
						where: { identityKey: action.route.normalizedValue },
						create: {
							contactId: action.contactId,
							companyId: action.contact.companyId,
							identityKey: action.route.normalizedValue,
							profileUrl: action.route.value,
							normalizedProfileUrl: action.route.normalizedValue,
							linkedinMemberIdentifier: action.route.linkedinMemberIdentifier,
							status: "ACTIVE",
							classification: "ACTION_REQUIRED",
							connectionState: "CONNECTED",
						},
						update: {},
					});
				}
				const matched = linkedInProfileRecordsMatch(
					{
						profileUrl: action.route.value,
						profileIdentifier: action.route.normalizedValue,
						stableMemberIdentifier: action.route.linkedinMemberIdentifier,
					},
					{
						profileUrl: conversation.profileUrl,
						profileIdentifier: conversation.normalizedProfileUrl,
						stableMemberIdentifier: conversation.linkedinMemberIdentifier,
					},
				);
				if (conversation.contactId !== action.contactId || !matched)
					throw new ConflictException(
						"LINKEDIN_MANUAL_CONVERSATION_IDENTITY_CHANGED",
					);
				messageId = (
					await tx.linkedInMessage.create({
						data: {
							conversationId: conversation.id,
							manualActionId: action.id,
							direction: "OUTBOUND",
							status: "SENT",
							provenance: "MANUAL",
							body: action.body,
							occurredAt,
							sourceKey: `linkedin-manual:${action.id}`,
							idempotencyKey: `linkedin-manual:${action.id}`,
							countsTowardAtlasMetrics: true,
							attributedToAtlas: false,
						},
						select: { id: true },
					})
				).id;
				const newerInbound = Boolean(
					conversation.lastInboundAt && conversation.lastInboundAt > occurredAt,
				);
				await tx.linkedInConversation.update({
					where: { id: conversation.id },
					data: {
						lastOutboundAt: occurredAt,
						lastMessageAt: occurredAt,
						...(newerInbound
							? {}
							: {
									status: "WAITING_ON_PROSPECT",
									classification: "WAITING_ON_PROSPECT",
								}),
						version: { increment: 1 },
					},
				});
				const currentEngagement = await tx.channelEngagementState.findUnique({
					where: {
						contactId_channel: {
							contactId: action.contactId,
							channel: LINKEDIN_CHANNEL,
						},
					},
					select: { lastInboundAt: true },
				});
				const preserveInboundState = Boolean(
					currentEngagement?.lastInboundAt &&
						currentEngagement.lastInboundAt > occurredAt,
				);
				await tx.channelEngagementState.upsert({
					where: {
						contactId_channel: {
							contactId: action.contactId,
							channel: LINKEDIN_CHANNEL,
						},
					},
					create: {
						contactId: action.contactId,
						channel: LINKEDIN_CHANNEL,
						status: "WAITING_ON_PROSPECT",
						lastOutboundAt: occurredAt,
					},
					update: {
						...(preserveInboundState ? {} : { status: "WAITING_ON_PROSPECT" }),
						lastOutboundAt: occurredAt,
						version: { increment: 1 },
					},
				});
			}
			const noNoteConnection =
				action.type === "CONNECTION_REQUEST" && !action.body?.trim();
			const activity = await tx.activity.create({
				data: {
					type: "NOTE",
					subject:
						action.type === "CONNECTION_REQUEST"
							? "LinkedIn connection request sent manually"
							: "LinkedIn message sent manually",
					body: noNoteConnection
						? "Connection request sent without a note."
						: action.body,
					occurredAt,
					contactId: action.contactId,
					companyId: action.contact.companyId,
					createdById: userId,
					linkedinMessageId: messageId,
					linkedinManualActionId: action.id,
					meta: {
						channel: LINKEDIN_CHANNEL,
						action: action.type,
						provenance: "MANUAL",
						manualConfirmation: true,
						browserProof: null,
						countsTowardAtlasMetrics: true,
						attributedToAtlas: false,
						noNote: noNoteConnection,
						idempotencyKey: action.idempotencyKey,
						status:
							action.type === "CONNECTION_REQUEST"
								? "MANUAL_CONFIRMED_PENDING"
								: "MANUAL_CONFIRMED_SENT",
					},
				},
			});
			if (isCold(action.type))
				await tx.relationshipColdTouchClaim.updateMany({
					where: {
						contactId: action.contactId,
						idempotencyKey: action.idempotencyKey,
						status: "CLAIMED",
					},
					data: { status: "CONSUMED", consumedAt: occurredAt },
				});
			await tx.linkedInManualAction.update({
				where: { id: action.id },
				data: {
					status: "COMPLETED",
					completedByUserId: userId,
					completedAt: new Date(),
					occurredAt,
					completionEvidence: {
						kind: "USER_CONFIRMED_MANUAL_ACTION",
						browserProof: null,
						confirmedAt: new Date().toISOString(),
					},
				},
			});
			return {
				actionId: action.id,
				messageId,
				activityId: activity.id,
				occurredAt,
			};
		});
	}
}
