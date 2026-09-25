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

export type CanonicalLinkedInProfileIdentity =
	| { kind: "PROFILE_SLUG"; value: string }
	| { kind: "OPAQUE"; value: string };

function canonicalProfileSlug(value: string): string | null {
	const trimmed = value.trim();
	if (
		!trimmed ||
		trimmed.includes("/") ||
		trimmed.includes("?") ||
		trimmed.includes("#")
	)
		return null;
	try {
		const decoded = decodeURIComponent(trimmed);
		if (!decoded || decoded.includes("/") || decoded.includes("\\"))
			return null;
		return encodeURIComponent(decoded).toLocaleLowerCase();
	} catch {
		return null;
	}
}

function profileSlugFromUrl(value: string): string | null {
	try {
		const url = new URL(value);
		const hostname = url.hostname.toLocaleLowerCase();
		if (hostname !== "linkedin.com" && hostname !== "www.linkedin.com")
			return null;
		const parts = url.pathname.split("/").filter(Boolean);
		if (parts.length !== 2 || parts[0]?.toLocaleLowerCase() !== "in")
			return null;
		return canonicalProfileSlug(parts[1] ?? "");
	} catch {
		return null;
	}
}

function profileSlugFromIdentifier(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (/^https?:\/\//i.test(trimmed)) return profileSlugFromUrl(trimmed);
	if (trimmed.startsWith("/"))
		return profileSlugFromUrl(`https://www.linkedin.com${trimmed}`);
	if (/^(?:www\.)?linkedin\.com\/in\//i.test(trimmed))
		return profileSlugFromUrl(`https://${trimmed}`);
	return canonicalProfileSlug(trimmed);
}

function isOpaqueStableIdentifier(value: string): boolean {
	return /^ACo[A-Za-z0-9_-]+$/.test(value.trim());
}

export function canonicalLinkedInProfileIdentity(
	value: string,
): CanonicalLinkedInProfileIdentity | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (isOpaqueStableIdentifier(trimmed))
		return { kind: "OPAQUE", value: trimmed };
	const slug = profileSlugFromIdentifier(trimmed);
	return slug ? { kind: "PROFILE_SLUG", value: slug } : null;
}

export function canonicalLinkedInProfileUrl(value: string): string {
	const slug = profileSlugFromUrl(value);
	return slug ? `https://linkedin.com/in/${slug}/` : value;
}

export function linkedInProfileIdentityMatches(
	target: { profileUrl: string; profileIdentifier: string | null },
	observed: { profileUrl: string | null; profileIdentifier: string | null },
): boolean {
	if (!observed.profileUrl || !observed.profileIdentifier) return false;
	const targetProfileIdentifier = target.profileIdentifier;
	if (!targetProfileIdentifier) return false;
	const targetUrlSlug = profileSlugFromUrl(target.profileUrl);
	const observedUrlSlug = profileSlugFromUrl(observed.profileUrl);
	if (!targetUrlSlug || !observedUrlSlug || targetUrlSlug !== observedUrlSlug)
		return false;
	const targetIdentity = canonicalLinkedInProfileIdentity(
		targetProfileIdentifier,
	);
	if (!targetIdentity) return false;
	if (targetIdentity.kind === "OPAQUE")
		return (
			observed.profileIdentifier === targetIdentity.value &&
			canonicalProfileSlug(observed.profileIdentifier) === observedUrlSlug
		);
	const observedIdentity = canonicalProfileSlug(observed.profileIdentifier);
	return (
		targetIdentity.value === targetUrlSlug &&
		observedIdentity === observedUrlSlug
	);
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
	if (!linkedInProfileIdentityMatches(target, observed))
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
