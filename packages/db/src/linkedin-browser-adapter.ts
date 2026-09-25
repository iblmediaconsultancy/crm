export type LinkedInRelationshipState =
	| "CONNECT"
	| "PENDING"
	| "CONNECTED"
	| "UNAVAILABLE"
	| "AMBIGUOUS";

export type LinkedInBrowserTarget = {
	contactId: string;
	routeId: string;
	profileUrl: string;
	profileIdentifier: string;
	displayName?: string | null;
	conversationId?: string;
	externalConversationKey?: string | null;
};

export type LinkedInBrowserIdentityEvidence = {
	resolution: "RESOLVED" | "AMBIGUOUS";
	profileUrl: string | null;
	profileIdentifier: string | null;
	displayName?: string | null;
	relationshipState?: LinkedInRelationshipState;
	pendingInvitationState?: "NONE" | "SENT" | "RECEIVED" | "UNKNOWN";
	conversationId?: string | null;
	externalConversationKey?: string | null;
	uiElementIndex?: number;
};

export type LinkedInBrowserAction = {
	jobId: string;
	action: "MESSAGE" | "CONNECTION_REQUEST";
	target: LinkedInBrowserTarget;
	body?: string;
	note?: string | null;
	browserSessionKey: string;
};

export type LinkedInBrowserOutcome =
	| {
			status: "CONFIRMED";
			externalMessageKey?: string | null;
			externalRequestKey?: string | null;
			externalConversationKey?: string | null;
			browserProof: Record<string, unknown>;
			observedIdentity: LinkedInBrowserIdentityEvidence;
			observedAt: Date;
	  }
	| {
			status: "AMBIGUOUS";
			errorCode:
				| "CAPTCHA"
				| "ACCOUNT_VERIFICATION"
				| "LINKEDIN_WARNING"
				| "SECURITY_CHALLENGE"
				| "RESTRICTION"
				| "SEND_STATE_UNCLEAR"
				| "IDENTITY_UNCLEAR"
				| "BROWSER_STATE_AMBIGUOUS"
				| "WRONG_CONVERSATION";
			browserProof?: Record<string, unknown>;
			observedIdentity?: LinkedInBrowserIdentityEvidence;
			observedAt: Date;
	  }
	| {
			status: "FAILED";
			errorCode: string;
			observedAt: Date;
	  };

export interface LinkedInBrowserAdapter {
	execute(action: LinkedInBrowserAction): Promise<LinkedInBrowserOutcome>;
}

function normalizeName(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function canonicalLinkedInProfileUrl(value: string): string {
	try {
		const url = new URL(value);
		url.hash = "";
		url.search = "";
		url.pathname = url.pathname.replace(/\/+$/, "");
		return `${url.origin}${url.pathname}/`;
	} catch {
		return value;
	}
}

export function verifyFreshLinkedInIdentity(
	target: LinkedInBrowserTarget,
	observed: LinkedInBrowserIdentityEvidence,
): { allowed: true } | { allowed: false; reason: string } {
	if (observed.resolution !== "RESOLVED")
		return { allowed: false, reason: "BROWSER_STATE_AMBIGUOUS" };
	if (
		!observed.profileUrl ||
		canonicalLinkedInProfileUrl(observed.profileUrl) !==
			canonicalLinkedInProfileUrl(target.profileUrl)
	)
		return { allowed: false, reason: "PROFILE_URL_MISMATCH" };
	if (
		!observed.profileIdentifier ||
		observed.profileIdentifier !== target.profileIdentifier
	)
		return { allowed: false, reason: "PROFILE_IDENTIFIER_MISMATCH" };
	if (
		target.displayName &&
		(!observed.displayName ||
			normalizeName(observed.displayName) !== normalizeName(target.displayName))
	)
		return { allowed: false, reason: "DISPLAY_NAME_MISMATCH" };
	if (
		target.conversationId &&
		observed.conversationId !== target.conversationId
	)
		return { allowed: false, reason: "CONVERSATION_ID_MISMATCH" };
	if (
		target.externalConversationKey &&
		observed.externalConversationKey !== target.externalConversationKey
	)
		return { allowed: false, reason: "EXTERNAL_CONVERSATION_MISMATCH" };
	return { allowed: true };
}

export function verifyLinkedInActionState(
	action: LinkedInBrowserAction,
	observed: LinkedInBrowserIdentityEvidence,
): { allowed: true } | { allowed: false; reason: string } {
	const identity = verifyFreshLinkedInIdentity(action.target, observed);
	if (!identity.allowed) return identity;
	if (
		action.action === "CONNECTION_REQUEST" &&
		observed.relationshipState !== "CONNECT"
	)
		return { allowed: false, reason: "CONNECTION_NOT_AVAILABLE" };
	if (action.action === "MESSAGE" && observed.relationshipState !== "CONNECTED")
		return { allowed: false, reason: "LINKEDIN_CONNECTION_REQUIRED" };
	return { allowed: true };
}

export function isManualReviewOutcome(
	outcome: LinkedInBrowserOutcome,
): boolean {
	return outcome.status === "AMBIGUOUS";
}
