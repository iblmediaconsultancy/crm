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
	conversationParticipantIdentifier?: string | null;
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

function displayNameTokens(value: string): string[] {
	const normalized = value
		.normalize("NFKC")
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.replace(/\s+/g, " ")
		.toLocaleLowerCase();
	const tokens = normalized ? normalized.split(" ") : [];
	const titles = new Set([
		"mr",
		"mrs",
		"ms",
		"miss",
		"dr",
		"prof",
		"coach",
		"sir",
	]);
	const suffixes = new Set([
		"jr",
		"sr",
		"ii",
		"iii",
		"iv",
		"v",
		"phd",
		"md",
		"esq",
	]);
	while (tokens.length > 0 && titles.has(tokens[0] ?? "")) tokens.shift();
	while (tokens.length > 0 && suffixes.has(tokens[tokens.length - 1] ?? ""))
		tokens.pop();
	return tokens;
}

export function linkedInDisplayNamesMatch(
	expected: string,
	observed: string,
): boolean {
	const expectedTokens = displayNameTokens(expected);
	const observedTokens = displayNameTokens(observed);
	if (!expectedTokens.length || !observedTokens.length) return false;
	if (expectedTokens.length === 1 || observedTokens.length === 1)
		return (
			expectedTokens.length === observedTokens.length &&
			expectedTokens[0] === observedTokens[0]
		);
	return (
		expectedTokens[0] === observedTokens[0] &&
		expectedTokens.at(-1) === observedTokens.at(-1)
	);
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

function canonicalLinkedInConversationKey(value: string): string | null {
	const decodeKey = (key: string): string => {
		try {
			return decodeURIComponent(key);
		} catch {
			return key;
		}
	};
	const trimmed = value.trim();
	if (!trimmed) return null;
	try {
		const url = new URL(
			trimmed.startsWith("/") ? `https://linkedin.com${trimmed}` : trimmed,
		);
		if (
			url.hostname.toLocaleLowerCase() !== "linkedin.com" &&
			url.hostname.toLocaleLowerCase() !== "www.linkedin.com"
		)
			return null;
		const match = url.pathname.match(/^\/messaging\/thread\/([^/?#]+)\/?$/i);
		if (!match?.[1]) return null;
		return decodeKey(match[1]);
	} catch {
		const match = trimmed.match(/^\/?messaging\/thread\/([^/?#]+)\/?$/i);
		return match?.[1] ? decodeKey(match[1]) : trimmed;
	}
}

function opaqueProfileIdentifierFromUrl(value: string): string | null {
	try {
		const url = new URL(value);
		const part = url.pathname.split("/").filter(Boolean).at(-1);
		return part && isOpaqueStableIdentifier(part) ? part : null;
	} catch {
		return null;
	}
}

export function linkedInConversationIdentityMatches(
	target: Pick<
		LinkedInBrowserTarget,
		"profileUrl" | "externalConversationKey"
	> & {
		profileIdentifier?: string | null;
	},
	observed: Pick<
		LinkedInBrowserIdentityEvidence,
		"externalConversationKey" | "conversationParticipantIdentifier"
	> & { profileUrl?: string | null },
): boolean {
	if (!target.externalConversationKey) return true;
	const targetKey = canonicalLinkedInConversationKey(
		target.externalConversationKey,
	);
	const observedKey = observed.externalConversationKey
		? canonicalLinkedInConversationKey(observed.externalConversationKey)
		: null;
	if (targetKey && observedKey && targetKey === observedKey) return true;
	const targetMember =
		opaqueProfileIdentifierFromUrl(target.profileUrl) ??
		(target.profileIdentifier &&
		isOpaqueStableIdentifier(target.profileIdentifier.trim())
			? target.profileIdentifier.trim()
			: null);
	return Boolean(
		targetMember &&
			observed.conversationParticipantIdentifier &&
			targetMember === observed.conversationParticipantIdentifier,
	);
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
			!linkedInDisplayNamesMatch(target.displayName, observed.displayName))
	)
		return { allowed: false, reason: "DISPLAY_NAME_MISMATCH" };
	if (
		target.conversationId &&
		observed.conversationId !== target.conversationId
	)
		return { allowed: false, reason: "CONVERSATION_ID_MISMATCH" };
	if (!linkedInConversationIdentityMatches(target, observed))
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
