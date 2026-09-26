import {
	coldOutreachBlockReason,
	type Db,
	isPersonProtected,
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

const LINKEDIN_CHANNEL = "LINKEDIN" as const;

type MessageRoutineAction = Exclude<
	LinkedInRoutineActionType,
	"CONNECTION_REQUEST"
>;

type CommonInput = {
	action: LinkedInRoutineActionType;
	idempotencyKey: string;
	actionPayload?: Prisma.InputJsonValue;
	context?: LinkedInActionContext;
	accountKey?: string;
	coldOutreach?: boolean;
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
			action: MessageRoutineAction;
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
						connectionLimit: input.connectionLimit,
					})
				: await this.channel.queueAction({
						conversationId: input.conversationId,
						action: "MESSAGE",
						idempotencyKey: input.idempotencyKey,
						actionPayload,
						body: input.body,
						approvedAt,
						coldOutreach,
						accountKey: input.accountKey,
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
			route.value !== input.profileUrl ||
			route.normalizedValue !== input.profileIdentifier
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

	private async preflightMessage(
		tx: Prisma.TransactionClient,
		input: Extract<
			LinkedInRoutineActionInput,
			{ action: MessageRoutineAction }
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
		if (!route)
			return {
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "LINKEDIN_ROUTE_NOT_ACTIVE",
			};
		if (
			(conversation.profileUrl && conversation.profileUrl !== route.value) ||
			(conversation.normalizedProfileUrl &&
				conversation.normalizedProfileUrl !== route.normalizedValue)
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
