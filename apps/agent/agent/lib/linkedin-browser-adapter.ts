export type LinkedInBrowserTarget = {
	contactId: string;
	routeId: string;
	profileUrl: string;
	profileIdentifier: string;
	conversationId?: string;
};

export type LinkedInBrowserIdentityEvidence = {
	resolution: "RESOLVED" | "AMBIGUOUS";
	profileUrl: string | null;
	profileIdentifier: string | null;
	conversationId?: string | null;
	uiElementIndex?: number;
};

export type LinkedInBrowserAction = {
	jobId: string;
	action: "MESSAGE" | "CONNECTION_REQUEST";
	target: LinkedInBrowserTarget;
	body?: string;
	browserSessionKey: string;
};

export type LinkedInBrowserOutcome =
	| {
			status: "CONFIRMED";
			externalMessageKey?: string | null;
			externalRequestKey?: string | null;
			browserProof?: Record<string, unknown>;
			observedIdentity?: LinkedInBrowserIdentityEvidence;
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
				| "IDENTITY_UNCLEAR";
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

export function verifyFreshLinkedInIdentity(
	target: LinkedInBrowserTarget,
	observed: LinkedInBrowserIdentityEvidence,
): { allowed: true } | { allowed: false; reason: string } {
	if (observed.resolution !== "RESOLVED")
		return { allowed: false, reason: "BROWSER_STATE_AMBIGUOUS" };
	if (!observed.profileUrl || observed.profileUrl !== target.profileUrl)
		return { allowed: false, reason: "PROFILE_URL_MISMATCH" };
	if (
		!observed.profileIdentifier ||
		observed.profileIdentifier !== target.profileIdentifier
	)
		return { allowed: false, reason: "PROFILE_IDENTIFIER_MISMATCH" };
	if (
		target.conversationId &&
		observed.conversationId !== target.conversationId
	)
		return { allowed: false, reason: "CONVERSATION_ID_MISMATCH" };
	return { allowed: true };
}

export function isManualReviewOutcome(
	outcome: LinkedInBrowserOutcome,
): boolean {
	return outcome.status === "AMBIGUOUS";
}
