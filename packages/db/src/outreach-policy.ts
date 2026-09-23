import type {
	ChannelEngagementStatus,
	OutreachChannel,
	RelationshipTouchStatus,
} from "./generated/prisma/enums";

const BLOCKED_PRICING_WORDS =
	/\b(?:pricing|prices?|costs?|budgets?|fees?|discounts?|rates?|packages?)\b/i;
const BLOCKED_CURRENCY_AMOUNT =
	/(?:[€$£]\s*\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d{1,2})?\s*[€$£])/i;
const BLOCKED_PERIODIC_AMOUNT =
	/\b\d+(?:[.,]\d+)?\s*(?:per\s+(?:month|mo|week|wk|year|yr)|\/\s*(?:month|mo|week|wk|year|yr))\b/i;
const BLOCKED_OUTCOME_CLAIM =
	/\b(?:guarantee(?:d)?|will\s+(?:sign|win|place)|certain\s+(?:deal|placement|contract))\b/i;

export function validateExternalCopy(input: {
	subject?: string | null;
	body?: string | null;
	followUpApproach?: string | null;
}): { valid: true } | { valid: false; reason: string } {
	const values = [input.subject, input.body, input.followUpApproach];
	const value = values.filter(Boolean).join("\n");
	if (!value.trim()) return { valid: false, reason: "External copy is empty." };
	if (value.includes("\u2014") || value.includes("\u2013"))
		return {
			valid: false,
			reason: "External copy contains forbidden dash punctuation.",
		};
	if (
		BLOCKED_PRICING_WORDS.test(value) ||
		BLOCKED_CURRENCY_AMOUNT.test(value) ||
		BLOCKED_PERIODIC_AMOUNT.test(value)
	)
		return {
			valid: false,
			reason: "Pricing language is not allowed in external outreach.",
		};
	if (BLOCKED_OUTCOME_CLAIM.test(value))
		return {
			valid: false,
			reason:
				"Unsupported guarantees or client-outcome claims are not allowed in external outreach.",
		};
	return { valid: true };
}

export type ColdOutreachPolicyInput = {
	contactOutreachState: "ALLOWED" | "PROTECTED" | "SUPPRESSED";
	leadAttentionState:
		| "NONE"
		| "NEEDS_IHSAN"
		| "WITH_IHSAN"
		| "PARKED"
		| "SUPPRESSED";
	channelStatus: ChannelEngagementStatus | null;
	otherChannelStatus: ChannelEngagementStatus | null;
	routeSuppressed: boolean;
	contactSuppressed: boolean;
	organizationSuppressed: boolean;
	organizationProtected?: boolean;
	firstTouchStatus: RelationshipTouchStatus | null;
};

export function coldOutreachBlockReason(
	input: ColdOutreachPolicyInput,
): string | null {
	if (input.contactOutreachState === "PROTECTED") return "PROTECTED_CONTACT";
	if (input.contactOutreachState === "SUPPRESSED") return "CONTACT_SUPPRESSED";
	if (input.leadAttentionState !== "NONE")
		return `LEAD_${input.leadAttentionState}`;
	if (input.routeSuppressed) return "CHANNEL_ROUTE_SUPPRESSED";
	if (input.contactSuppressed) return "CONTACT_SUPPRESSED";
	if (input.organizationProtected) return "ORGANIZATION_OWNER_PROTECTED";
	if (input.organizationSuppressed) return "ORGANIZATION_SUPPRESSED";
	if (input.channelStatus === "ACTIVE_HUMAN_CONVERSATION")
		return "ACTIVE_HUMAN_CONVERSATION";
	if (input.otherChannelStatus === "ACTIVE_HUMAN_CONVERSATION")
		return "OTHER_CHANNEL_ACTIVE_HUMAN_CONVERSATION";
	if (input.channelStatus === "NEEDS_IHSAN") return "CHANNEL_NEEDS_IHSAN";
	if (input.otherChannelStatus === "NEEDS_IHSAN")
		return "OTHER_CHANNEL_NEEDS_IHSAN";
	if (input.firstTouchStatus === "CLAIMED") return "FIRST_TOUCH_CLAIMED";
	if (input.firstTouchStatus === "CONSUMED") return "FIRST_TOUCH_CONSUMED";
	return null;
}

export function shouldCancelFollowUp(
	planChannel: OutreachChannel,
	inboundChannel: OutreachChannel,
): boolean {
	return planChannel === inboundChannel;
}

export function isGlobalSuppression(
	scope: "ROUTE" | "CONTACT" | "ORGANIZATION",
): boolean {
	return scope === "CONTACT" || scope === "ORGANIZATION";
}

export function isHistoricalLinkedInMessage(
	attributedToAtlas: boolean,
): boolean {
	return !attributedToAtlas;
}
