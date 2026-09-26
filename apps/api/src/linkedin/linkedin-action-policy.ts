export const LINKEDIN_ACTION_POLICY_VERSION = "linkedin-routine-v1";

export type LinkedInRoutineActionType =
	| "CONNECTION_REQUEST"
	| "FIRST_MESSAGE_TO_CONNECTED_PERSON"
	| "EXISTING_CONVERSATION_MESSAGE"
	| "ROUTINE_REPLY";

export type LinkedInActionClassification =
	| "ROUTINE_AUTONOMOUS"
	| "WITH_IHSAN"
	| "BLOCKED"
	| "AMBIGUOUS_REVIEW_REQUIRED";

export type LinkedInActionContext = {
	pricing?: boolean;
	packages?: boolean;
	discounts?: boolean;
	proposal?: boolean;
	negotiation?: boolean;
	contract?: boolean;
	sponsorshipCommitment?: boolean;
	sensitiveRelationship?: boolean;
	explicitIhsanRequest?: boolean;
	strategicAmbiguity?: boolean;
	identityVerified?: boolean;
	relationshipVerified?: boolean;
	conversationVerified?: boolean;
};

export type LinkedInActionPolicyDecision = {
	classification: LinkedInActionClassification;
	reason: string | null;
};

const HANDOFF_COPY = [
	/\b(?:pricing|price|prices|cost|costs|fee|fees|rate|rates|budget|budgets)\b/i,
	/\b(?:package|packages|discount|discounts|proposal|proposals|quote|quotes)\b/i,
	/\b(?:negotiate|negotiation|negotiating|contract|contracts|agreement|agreements)\b/i,
	/\b(?:sponsor|sponsorship|sponsoring|commercial commitment|binding commitment)\b/i,
	/\b(?:confirm|book|schedule|set up)\s+(?:a\s+)?(?:meeting|call)\b/i,
];

function hasHandoffSignal(context: LinkedInActionContext): string | null {
	const signals: Array<[keyof LinkedInActionContext, string]> = [
		["pricing", "PRICING"],
		["packages", "PACKAGES"],
		["discounts", "DISCOUNTS"],
		["proposal", "PROPOSAL"],
		["negotiation", "NEGOTIATION"],
		["contract", "CONTRACT"],
		["sponsorshipCommitment", "SPONSORSHIP_COMMITMENT"],
		["sensitiveRelationship", "SENSITIVE_RELATIONSHIP"],
		["explicitIhsanRequest", "EXPLICIT_IHSAN_REQUEST"],
		["strategicAmbiguity", "STRATEGIC_AMBIGUITY"],
	];
	for (const [key, reason] of signals) if (context[key] === true) return reason;
	return null;
}

export function classifyLinkedInAction(input: {
	action: LinkedInRoutineActionType;
	body?: string | null;
	context?: LinkedInActionContext;
}): LinkedInActionPolicyDecision {
	const context = input.context ?? {};
	const body = input.body?.trim() ?? "";
	if (input.action !== "CONNECTION_REQUEST" && !body)
		return { classification: "BLOCKED", reason: "MESSAGE_BODY_REQUIRED" };
	const handoffSignal = hasHandoffSignal(context);
	if (handoffSignal)
		return { classification: "WITH_IHSAN", reason: handoffSignal };
	if (body && HANDOFF_COPY.some((pattern) => pattern.test(body)))
		return { classification: "WITH_IHSAN", reason: "COMMERCIAL_HANDOFF_COPY" };
	if (context.identityVerified === false)
		return {
			classification: "AMBIGUOUS_REVIEW_REQUIRED",
			reason: "IDENTITY_NOT_VERIFIED",
		};
	if (context.relationshipVerified === false)
		return {
			classification: "AMBIGUOUS_REVIEW_REQUIRED",
			reason: "RELATIONSHIP_NOT_VERIFIED",
		};
	if (
		(input.action === "EXISTING_CONVERSATION_MESSAGE" ||
			input.action === "ROUTINE_REPLY") &&
		context.conversationVerified === false
	)
		return {
			classification: "AMBIGUOUS_REVIEW_REQUIRED",
			reason: "CONVERSATION_NOT_VERIFIED",
		};
	return { classification: "ROUTINE_AUTONOMOUS", reason: null };
}
