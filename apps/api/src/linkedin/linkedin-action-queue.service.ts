import {
	coldOutreachBlockReason,
	type Db,
	isPersonProtected,
	linkedInProfileRecordsMatch,
	Prisma,
} from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	classifyLinkedInAction,
	LINKEDIN_ACTION_POLICY_VERSION,
	type LinkedInActionClassification,
	type LinkedInActionContext,
	type LinkedInRoutineActionType,
} from "./linkedin-action-policy";
import { LinkedInChannelService } from "./linkedin-channel.service";
import { canReuseConsumedLinkedInConnectionClaim } from "./linkedin-first-touch";
import { hasSubstantiveLinkedInHistory } from "./linkedin-history";

const LINKEDIN_CHANNEL = "LINKEDIN" as const;

type MessageRoutineAction = Exclude<
	LinkedInRoutineActionType,
	"CONNECTION_REQUEST"
>;

type ExistingConversationMessageAction = Exclude<
	MessageRoutineAction,
	"FIRST_MESSAGE_TO_CONNECTED_PERSON"
>;

type CommonInput = {
	action: LinkedInRoutineActionType;
	idempotencyKey: string;
	actionPayload?: Prisma.InputJsonValue;
	context?: LinkedInActionContext;
	accountKey?: string;
	coldOutreach?: boolean;
	messageLimit?: number;
	connectionLimit?: number;
};

export type LinkedInRoutineActionInput =
	| (CommonInput & {
			action: "CONNECTION_REQUEST";
			contactId: string;
			routeId: string;
			profileUrl: string;
			profileIdentifier: string;
	  })
	| (CommonInput & {
			action: "FIRST_MESSAGE_TO_CONNECTED_PERSON";
			contactId: string;
			routeId: string;
			profileUrl: string;
			profileIdentifier: string;
			body: string;
	  })
	| (CommonInput & {
			action: ExistingConversationMessageAction;
			conversationId: string;
			body: string;
	  });

export type LinkedInRoutineActionResult = {
	classification: LinkedInActionClassification;
	action: LinkedInRoutineActionType;
	jobId: string | null;
	approvedAt: Date | null;
	reason: string | null;
};

type PreflightResult = {
	classification: LinkedInActionClassification;
	reason: string | null;
	conversationId?: string;
	identityKey?: string;
	profileUrl?: string;
	normalizedProfileUrl?: string;
};

function routineColdOutreach(action: LinkedInRoutineActionType): boolean {
	return (
		action === "CONNECTION_REQUEST" ||
		action === "FIRST_MESSAGE_TO_CONNECTED_PERSON"
	);
}

function policyPayload(
	input: LinkedInRoutineActionInput,
	classification: "ROUTINE_AUTONOMOUS",
): Prisma.InputJsonObject {
	const base =
		input.actionPayload &&
		typeof input.actionPayload === "object" &&
		!Array.isArray(input.actionPayload)
			? (input.actionPayload as Prisma.InputJsonObject)
			: {};
	return {
		...base,
		atlasActionType: input.action,
		atlasPolicy: {
			version: LINKEDIN_ACTION_POLICY_VERSION,
			classification,
		},
	};
}

function hasRoutineReason(input: LinkedInRoutineActionInput): boolean {
	if (!input.actionPayload || typeof input.actionPayload !== "object")
		return false;
	if (Array.isArray(input.actionPayload)) return false;
	const payload = input.actionPayload as Record<string, unknown>;
	return ["researchReason", "revivalReason", "legitimateReason"].some(
		(key) => typeof payload[key] === "string" && payload[key].trim().length > 0,
	);
}

function result(
	input: LinkedInRoutineActionInput,
	classification: LinkedInActionClassification,
	reason: string | null,
	jobId: string | null = null,
	approvedAt: Date | null = null,
): LinkedInRoutineActionResult {
	return { classification, action: input.action, jobId, approvedAt, reason };
}

@Injectable()
export class LinkedInActionQueueService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly channel: LinkedInChannelService,
	) {}

	async queueRoutineAction(
		input: LinkedInRoutineActionInput,
	): Promise<LinkedInRoutineActionResult> {
		const policy = classifyLinkedInAction({
			action: input.action,
			body: "body" in input ? input.body : null,
			context: input.context,
		});
		if (policy.classification !== "ROUTINE_AUTONOMOUS")
			return result(input, policy.classification, policy.reason);

		const preflight = await this.preflight(input);
		if (preflight.classification !== "ROUTINE_AUTONOMOUS")
			return result(input, preflight.classification, preflight.reason);

		let conversationId =
			"conversationId" in input ? input.conversationId : null;
		if (input.action === "FIRST_MESSAGE_TO_CONNECTED_PERSON") {
			if (
				!preflight.identityKey ||
				!preflight.profileUrl ||
				!preflight.normalizedProfileUrl
			)
				return result(
					input,
					"AMBIGUOUS_REVIEW_REQUIRED",
					"LINKEDIN_CONVERSATION_TARGET_UNRESOLVED",
				);
			const conversation = await this.channel.ensureConversation({
				contactId: input.contactId,
				identityKey: preflight.identityKey,
				profileUrl: preflight.profileUrl,
				normalizedProfileUrl: preflight.normalizedProfileUrl,
				connectionState: "CONNECTED",
				status: "ACTIVE",
				classification: "ACTION_REQUIRED",
			});
			conversationId = conversation.id;
		}
		const approvedAt = new Date();
		const coldOutreach =
			input.coldOutreach ?? routineColdOutreach(input.action);
		const actionPayload = policyPayload(input, "ROUTINE_AUTONOMOUS");
		const job =
			input.action === "CONNECTION_REQUEST"
				? await this.channel.queueConnectionRequest({
						contactId: input.contactId,
						routeId: input.routeId,
						profileUrl: input.profileUrl,
						profileIdentifier: input.profileIdentifier,
						idempotencyKey: input.idempotencyKey,
						actionPayload,
						approvedAt,
						coldOutreach,
						accountKey: input.accountKey,
						messageLimit: input.messageLimit,
						connectionLimit: input.connectionLimit,
					})
				: await this.channel.queueAction({
						conversationId: conversationId as string,
						action: "MESSAGE",
						idempotencyKey: input.idempotencyKey,
						actionPayload,
						body: input.body,
						approvedAt,
						coldOutreach,
						firstMessage: input.action === "FIRST_MESSAGE_TO_CONNECTED_PERSON",
						accountKey: input.accountKey,
						messageLimit: input.messageLimit,
						connectionLimit: input.connectionLimit,
					});
		return result(input, "ROUTINE_AUTONOMOUS", null, job.id, approvedAt);
	}

	private async preflight(
		input: LinkedInRoutineActionInput,
	): Promise<PreflightResult> {
		return withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				if (input.action === "CONNECTION_REQUEST")
					return this.preflightConnection(tx, input);
				if (input.action === "FIRST_MESSAGE_TO_CONNECTED_PERSON")
					return this.preflightFirstMessage(tx, input);
				return this.preflightMessage(tx, input);
			},
		);
	}

	private async preflightConnection(
		tx: Prisma.TransactionClient,
		input: Extract<
			LinkedInRoutineActionInput,
			{ action: "CONNECTION_REQUEST" }
		>,
	): Promise<PreflightResult> {
		const [contact, route, personProtected] = await Promise.all([
			tx.contact.findUnique({
				where: { id: input.contactId },
				select: { companyId: true, outreachState: true },
			}),
			tx.contactRoute.findFirst({
				where: {
					id: input.routeId,
					contactId: input.contactId,
					type: "LINKEDIN",
					lifecycleState: "ACTIVE",
				},
				select: { value: true, normalizedValue: true },
			}),
			isPersonProtected(tx, input.contactId),
		]);
		if (!contact)
			return { classification: "BLOCKED", reason: "CONTACT_NOT_FOUND" };
		if (!route)
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "LINKEDIN_ROUTE_NOT_ACTIVE",
			};
		if (
			!linkedInProfileRecordsMatch(
				{
					profileUrl: route.value,
					profileIdentifier: route.normalizedValue,
				},
				{
					profileUrl: input.profileUrl,
					profileIdentifier: input.profileIdentifier,
				},
			)
		)
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "LINKEDIN_ROUTE_IDENTITY_CHANGED",
			};
		if (personProtected)
			return { classification: "BLOCKED", reason: "PERSON_OWNER_PROTECTED" };
		if (contact.outreachState !== "ALLOWED")
			return {
				classification: "BLOCKED",
				reason: `CONTACT_${contact.outreachState}`,
			};
		const [
			organizationProtection,
			suppressions,
			channelState,
			otherState,
			claim,
		] = await Promise.all([
			tx.organizationProtection.findFirst({
				where: { companyId: contact.companyId ?? "", status: "ACTIVE" },
				select: { id: true },
			}),
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
				select: { status: true },
			}),
		]);
		if (organizationProtection)
			return {
				classification: "BLOCKED",
				reason: "ORGANIZATION_OWNER_PROTECTED",
			};
		if (suppressions.length > 0)
			return { classification: "BLOCKED", reason: "LINKEDIN_SUPPRESSION" };
		if (otherState?.status === "NEEDS_IHSAN")
			return {
				classification: "WITH_IHSAN",
				reason: "OTHER_CHANNEL_NEEDS_IHSAN",
			};
		const coldReason = coldOutreachBlockReason({
			contactOutreachState: contact.outreachState,
			leadAttentionState: "NONE",
			channelStatus: channelState?.status ?? null,
			otherChannelStatus: otherState?.status ?? null,
			routeSuppressed: false,
			contactSuppressed: false,
			organizationSuppressed: false,
			organizationProtected: false,
			firstTouchStatus: claim?.status ?? null,
			personProtected: false,
		});
		if (coldReason && coldReason !== "FIRST_TOUCH_CLAIMED")
			return { classification: "BLOCKED", reason: coldReason };
		return { classification: "ROUTINE_AUTONOMOUS", reason: null };
	}

	private async preflightFirstMessage(
		tx: Prisma.TransactionClient,
		input: Extract<
			LinkedInRoutineActionInput,
			{ action: "FIRST_MESSAGE_TO_CONNECTED_PERSON" }
		>,
	): Promise<PreflightResult> {
		const [contact, route, personProtected] = await Promise.all([
			tx.contact.findUnique({
				where: { id: input.contactId },
				select: {
					companyId: true,
					lifecycleState: true,
					outreachState: true,
				},
			}),
			tx.contactRoute.findFirst({
				where: {
					id: input.routeId,
					contactId: input.contactId,
					type: "LINKEDIN",
					lifecycleState: "ACTIVE",
				},
				select: { value: true, normalizedValue: true },
			}),
			isPersonProtected(tx, input.contactId),
		]);
		if (!contact)
			return { classification: "BLOCKED", reason: "CONTACT_NOT_FOUND" };
		if (!route)
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "LINKEDIN_ROUTE_NOT_ACTIVE",
			};
		if (
			!linkedInProfileRecordsMatch(
				{
					profileUrl: route.value,
					profileIdentifier: route.normalizedValue,
				},
				{
					profileUrl: input.profileUrl,
					profileIdentifier: input.profileIdentifier,
				},
			)
		)
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "LINKEDIN_ROUTE_IDENTITY_CHANGED",
			};
		if (personProtected)
			return { classification: "BLOCKED", reason: "PERSON_OWNER_PROTECTED" };
		if (input.context?.identityVerified !== true)
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "IDENTITY_NOT_VERIFIED",
			};
		if (input.context?.relationshipVerified !== true)
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "RELATIONSHIP_NOT_VERIFIED",
			};
		if (input.context?.relationshipState !== "CONNECTED")
			return {
				classification:
					input.context.relationshipState === "UNKNOWN"
						? "AMBIGUOUS_REVIEW_REQUIRED"
						: "BLOCKED",
				reason:
					input.context.relationshipState === "UNKNOWN"
						? "RELATIONSHIP_STATE_AMBIGUOUS"
						: "LINKEDIN_CONNECTION_REQUIRED",
			};

		const [
			conversation,
			organizationProtection,
			suppressions,
			channelState,
			otherState,
			claim,
			lead,
			historicalActivities,
		] = await Promise.all([
			tx.linkedInConversation.findUnique({
				where: { identityKey: route.normalizedValue },
				select: {
					id: true,
					contactId: true,
					profileUrl: true,
					normalizedProfileUrl: true,
					connectionState: true,
					consent: true,
					status: true,
					classification: true,
					messages: {
						where: {
							direction: "OUTBOUND",
							status: {
								in: ["HISTORICAL", "QUEUED", "SENDING", "SENT", "AMBIGUOUS"],
							},
						},
						select: { status: true },
						take: 1,
					},
				},
			}),
			tx.organizationProtection.findFirst({
				where: { companyId: contact.companyId ?? "", status: "ACTIVE" },
				select: { id: true },
			}),
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
				select: { attentionState: true },
				orderBy: { updatedAt: "desc" },
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
		const [connectionRequest, messageJob] =
			claim?.status === "CONSUMED"
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
		const canReuseConnectionClaim = canReuseConsumedLinkedInConnectionClaim({
			claimChannel: claim?.channel,
			claimStatus: claim?.status,
			claimIdempotencyKey: claim?.idempotencyKey,
			connectionRequest,
			messageJobExists: Boolean(messageJob),
			historicalConnectionRequestActivities: historicalActivities,
		});
		if (conversation && conversation.contactId !== input.contactId)
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "LINKEDIN_IDENTITY_ATTACHED_TO_ANOTHER_CONTACT",
			};
		if (
			conversation &&
			(!conversation.profileUrl ||
				!linkedInProfileRecordsMatch(
					{
						profileUrl: route.value,
						profileIdentifier: route.normalizedValue,
					},
					{
						profileUrl: conversation.profileUrl,
						profileIdentifier: conversation.normalizedProfileUrl,
					},
				))
		)
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "LINKEDIN_CONVERSATION_IDENTITY_CHANGED",
			};
		if (organizationProtection)
			return {
				classification: "BLOCKED",
				reason: "ORGANIZATION_OWNER_PROTECTED",
			};
		if (suppressions.length > 0)
			return { classification: "BLOCKED", reason: "LINKEDIN_SUPPRESSION" };
		if (conversation?.messages[0]?.status === "AMBIGUOUS")
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "LINKEDIN_FIRST_MESSAGE_HISTORY_AMBIGUOUS",
			};
		if (conversation?.messages[0])
			return {
				classification: "BLOCKED",
				reason: "LINKEDIN_FIRST_MESSAGE_ALREADY_SENT",
			};
		if (hasSubstantiveLinkedInHistory(historicalActivities))
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "LINKEDIN_HISTORY_REQUIRES_RECONCILIATION",
			};
		if (
			conversation?.status === "PARKED" ||
			conversation?.classification === "PARKED_NO_CURRENT_NEED"
		)
			return {
				classification: "BLOCKED",
				reason: "LINKEDIN_CONVERSATION_PARKED",
			};
		if (
			conversation?.status === "CLOSED" ||
			conversation?.classification === "CLOSED_OR_DO_NOT_PUSH"
		)
			return {
				classification: "BLOCKED",
				reason: "LINKEDIN_CONVERSATION_CLOSED",
			};
		if (conversation?.status === "WAITING_ON_PROSPECT")
			return {
				classification: "BLOCKED",
				reason: "LINKEDIN_CONVERSATION_WAITING_ON_PROSPECT",
			};
		if (conversation?.consent === "DO_NOT_CONTACT")
			return {
				classification: "BLOCKED",
				reason: "LINKEDIN_CONVERSATION_SUPPRESSED",
			};
		if (
			conversation?.status === "NEEDS_IHSAN" ||
			conversation?.classification === "WARM_HANDOFF"
		)
			return {
				classification: "WITH_IHSAN",
				reason: "CONVERSATION_NEEDS_IHSAN",
			};
		if (conversation?.classification === "AMBIGUOUS_OR_NEEDS_IHSAN")
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "CONVERSATION_AMBIGUOUS",
			};
		if (contact.lifecycleState !== "ACTIVE")
			return { classification: "BLOCKED", reason: "CONTACT_NOT_ACTIVE" };
		if (contact.outreachState !== "ALLOWED")
			return {
				classification: "BLOCKED",
				reason: `CONTACT_${contact.outreachState}`,
			};
		if (channelState?.status === "NEEDS_IHSAN")
			return { classification: "WITH_IHSAN", reason: "CHANNEL_NEEDS_IHSAN" };
		if (otherState?.status === "NEEDS_IHSAN")
			return {
				classification: "WITH_IHSAN",
				reason: "OTHER_CHANNEL_NEEDS_IHSAN",
			};
		if (lead?.attentionState && lead.attentionState !== "NONE")
			return {
				classification: "WITH_IHSAN",
				reason: `LEAD_${lead.attentionState}`,
			};
		const coldReason = coldOutreachBlockReason({
			contactOutreachState: contact.outreachState,
			leadAttentionState: lead?.attentionState ?? "NONE",
			channelStatus: channelState?.status ?? null,
			otherChannelStatus: otherState?.status ?? null,
			routeSuppressed: false,
			contactSuppressed: false,
			organizationSuppressed: false,
			organizationProtected: false,
			firstTouchStatus: canReuseConnectionClaim
				? null
				: (claim?.status ?? null),
			personProtected: false,
		});
		if (
			coldReason &&
			!(
				canReuseConnectionClaim &&
				(coldReason === "FIRST_TOUCH_CLAIMED" ||
					coldReason === "FIRST_TOUCH_CONSUMED")
			)
		)
			return { classification: "BLOCKED", reason: coldReason };
		return {
			classification: "ROUTINE_AUTONOMOUS",
			reason: null,
			conversationId: conversation?.id,
			identityKey: route.normalizedValue,
			profileUrl: route.value,
			normalizedProfileUrl: route.normalizedValue,
		};
	}

	private async preflightMessage(
		tx: Prisma.TransactionClient,
		input: Extract<
			LinkedInRoutineActionInput,
			{ action: ExistingConversationMessageAction }
		>,
	): Promise<PreflightResult> {
		const conversation = await tx.linkedInConversation.findUnique({
			where: { id: input.conversationId },
			select: {
				contactId: true,
				companyId: true,
				profileUrl: true,
				normalizedProfileUrl: true,
				connectionState: true,
				consent: true,
				status: true,
				classification: true,
				lastInboundAt: true,
				lastOutboundAt: true,
			},
		});
		if (!conversation)
			return { classification: "BLOCKED", reason: "CONVERSATION_NOT_FOUND" };
		const [
			contact,
			route,
			personProtected,
			organizationProtection,
			suppressions,
			channelState,
			otherState,
			claim,
		] = await Promise.all([
			tx.contact.findUnique({
				where: { id: conversation.contactId },
				select: {
					lifecycleState: true,
					outreachState: true,
					companyId: true,
				},
			}),
			tx.contactRoute.findFirst({
				where: {
					contactId: conversation.contactId,
					type: "LINKEDIN",
					lifecycleState: "ACTIVE",
				},
				select: { value: true, normalizedValue: true },
			}),
			isPersonProtected(tx, conversation.contactId),
			tx.organizationProtection.findFirst({
				where: { companyId: conversation.companyId ?? "", status: "ACTIVE" },
				select: { id: true },
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
			tx.relationshipColdTouchClaim.findUnique({
				where: { contactId: conversation.contactId },
				select: { status: true, idempotencyKey: true },
			}),
		]);
		if (!contact)
			return { classification: "BLOCKED", reason: "CONTACT_NOT_FOUND" };
		if (personProtected)
			return { classification: "BLOCKED", reason: "PERSON_OWNER_PROTECTED" };
		if (organizationProtection)
			return {
				classification: "BLOCKED",
				reason: "ORGANIZATION_OWNER_PROTECTED",
			};
		if (suppressions.length > 0)
			return { classification: "BLOCKED", reason: "LINKEDIN_SUPPRESSION" };
		if (
			conversation.status === "NEEDS_IHSAN" ||
			conversation.classification === "WARM_HANDOFF"
		)
			return {
				classification: "WITH_IHSAN",
				reason: "CONVERSATION_NEEDS_IHSAN",
			};
		if (conversation.classification === "AMBIGUOUS_OR_NEEDS_IHSAN")
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "CONVERSATION_AMBIGUOUS",
			};
		if (
			conversation.status === "PARKED" ||
			conversation.classification === "PARKED_NO_CURRENT_NEED"
		)
			return {
				classification: "BLOCKED",
				reason: "LINKEDIN_CONVERSATION_PARKED",
			};
		if (
			conversation.status === "CLOSED" ||
			conversation.classification === "CLOSED_OR_DO_NOT_PUSH"
		)
			return {
				classification: "BLOCKED",
				reason: "LINKEDIN_CONVERSATION_CLOSED",
			};
		if (conversation.status === "WAITING_ON_PROSPECT")
			return {
				classification: "BLOCKED",
				reason: "LINKEDIN_CONVERSATION_WAITING_ON_PROSPECT",
			};
		if (!route)
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "LINKEDIN_ROUTE_NOT_ACTIVE",
			};
		if (
			conversation.profileUrl &&
			!linkedInProfileRecordsMatch(
				{
					profileUrl: route.value,
					profileIdentifier: route.normalizedValue,
				},
				{
					profileUrl: conversation.profileUrl,
					profileIdentifier: conversation.normalizedProfileUrl,
				},
			)
		)
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "LINKEDIN_ROUTE_IDENTITY_CHANGED",
			};
		if (conversation.consent === "DO_NOT_CONTACT")
			return {
				classification: "BLOCKED",
				reason: "LINKEDIN_CONVERSATION_SUPPRESSED",
			};
		if (conversation.connectionState !== "CONNECTED")
			return {
				classification: "BLOCKED",
				reason: "LINKEDIN_CONNECTION_REQUIRED",
			};
		if (contact.lifecycleState !== "ACTIVE")
			return { classification: "BLOCKED", reason: "CONTACT_NOT_ACTIVE" };
		if (contact.outreachState !== "ALLOWED" && input.coldOutreach !== false)
			return {
				classification: "BLOCKED",
				reason: `CONTACT_${contact.outreachState}`,
			};
		if (channelState?.status === "NEEDS_IHSAN")
			return { classification: "WITH_IHSAN", reason: "CHANNEL_NEEDS_IHSAN" };
		if (otherState?.status === "NEEDS_IHSAN")
			return {
				classification: "WITH_IHSAN",
				reason: "OTHER_CHANNEL_NEEDS_IHSAN",
			};
		if (
			input.action === "EXISTING_CONVERSATION_MESSAGE" &&
			conversation.lastOutboundAt &&
			(!conversation.lastInboundAt ||
				conversation.lastInboundAt <= conversation.lastOutboundAt) &&
			!hasRoutineReason(input)
		)
			return {
				classification: "BLOCKED",
				reason: "CONVERSATION_REQUIRES_NEW_REASON",
			};
		const coldOutreach =
			input.coldOutreach ?? routineColdOutreach(input.action);
		if (coldOutreach) {
			const coldReason = coldOutreachBlockReason({
				contactOutreachState: contact.outreachState,
				leadAttentionState: "NONE",
				channelStatus: channelState?.status ?? null,
				otherChannelStatus: otherState?.status ?? null,
				routeSuppressed: false,
				contactSuppressed: false,
				organizationSuppressed: false,
				organizationProtected: false,
				firstTouchStatus: claim?.status ?? null,
				personProtected: false,
			});
			if (coldReason && coldReason !== "FIRST_TOUCH_CLAIMED")
				return { classification: "BLOCKED", reason: coldReason };
		}
		return { classification: "ROUTINE_AUTONOMOUS", reason: null };
	}
}
