export const COMMERCIAL_QUALITY_STATUSES = [
	"SENDABLE",
	"HOLD_NEEDS_ENRICHMENT",
	"BLOCK_DUPLICATE_OPPORTUNITY",
	"BLOCK_ACTIVE_RELATIONSHIP",
	"BLOCK_PROTECTION",
	"BLOCK_CONTACT_ONCE",
	"BLOCK_LOW_COMMERCIAL_QUALITY",
] as const;

const COMMERCIAL_CORE_DIMENSIONS = new Set([
	"mediaGap",
	"iblFit",
	"agencyLeverage",
	"decisionMakerQuality",
	"opportunityDistinctness",
	"hookStrength",
]);

export type CommercialQualityStatus =
	(typeof COMMERCIAL_QUALITY_STATUSES)[number];

export const COMMERCIAL_ORGANIZATION_DENSITY_LIMIT = 2;
export const COMMERCIAL_ORGANIZATION_DENSITY_WINDOW_BUSINESS_DAYS = 5;
export const COMMERCIAL_QUALITY_SENDABLE_THRESHOLD = 70;
export const COMMERCIAL_ENRICHMENT_MAX_ATTEMPTS = 3;

export type CommercialLanguage = "English" | "Dutch" | "Turkish";
export type CommercialLanguageConfidence = "HIGH" | "MEDIUM" | "LOW";
export type CommercialRating = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export type CommercialQualityReasonCode =
	| "CURRENT_CLUB_UNVERIFIED"
	| "MALFORMED_PLAYER_IDENTITY"
	| "PLACEHOLDER_HOOK"
	| "FABRICATED_OR_CONTRADICTED_HOOK"
	| "WHY_NOW_UNSUPPORTED"
	| "UNRESOLVED_ORGANIZATION"
	| "UNRESOLVED_PLAYER_ORGANIZATION_ASSOCIATION"
	| "UNRESOLVED_TEMPLATE_TOKENS"
	| "SUBJECT_BODY_MISMATCH"
	| "ROUTE_OPPORTUNITY_CONFLICT"
	| "LANGUAGE_ROUTING_CONFLICT"
	| "OPPORTUNITY_ALREADY_ACTIVE"
	| "ORGANIZATION_DENSITY_LIMIT"
	| "ACTIVE_RELATIONSHIP"
	| "PERSON_OWNER_PROTECTED"
	| "ORGANIZATION_PROTECTED"
	| "PLAYER_PROTECTED"
	| "CONTACT_ONCE_ALREADY_CLAIMED"
	| "LANGUAGE_EVIDENCE_MISSING"
	| "CAREER_STAGE_MISSING"
	| "MOMENTUM_EVIDENCE_MISSING"
	| "MEDIA_GAP_EVIDENCE_MISSING"
	| "IBL_FIT_EVIDENCE_MISSING"
	| "MEDIA_SOPHISTICATION_EVIDENCE_MISSING"
	| "AGENCY_LEVERAGE_EVIDENCE_MISSING"
	| "DECISION_MAKER_EVIDENCE_MISSING"
	| "ACCESSIBILITY_EVIDENCE_MISSING"
	| "EVIDENCE_FRESHNESS_MISSING"
	| "OPPORTUNITY_DISTINCTNESS_MISSING"
	| "HOOK_STRENGTH_MISSING"
	| "SCARCE_SLOT_WORTHINESS_MISSING"
	| "LOW_COMMERCIAL_QUALITY";

export type CommercialQualityReason = {
	code: CommercialQualityReasonCode;
	message: string;
};

export type CommercialLanguageInput = {
	profileLanguage?: string | null;
	profileLanguages?: string[];
	languageSignals?: string[];
	organizationDomain?: string | null;
	organizationName?: string | null;
	contactName?: string | null;
};

export type CommercialLanguageRoute = {
	language: CommercialLanguage;
	confidence: CommercialLanguageConfidence;
	evidence: string[];
	reason: string;
};

export type CommercialQualityInput = {
	organization: string;
	playerOrOpportunity: string;
	campaignPurpose: string;
	requestedLanguage?: string | null;
	currentClub?: string | null;
	currentClubVerified?: boolean;
	currentClubRequired?: boolean;
	copyReferencesCurrentClub?: boolean;
	whyNowRequiresClub?: boolean;
	associationRequiresClub?: boolean;
	identityResolved?: boolean;
	organizationResolved?: boolean;
	playerOrganizationAssociationResolved?: boolean;
	whyNowSupported?: boolean;
	whyNowRequired?: boolean;
	fabricatedOrContradictedHook?: boolean;
	placeholderHook?: boolean;
	subject?: string | null;
	body?: string | null;
	subjectBodyAligned?: boolean;
	routeOpportunityConflict?: boolean;
	opportunityAlreadyActive?: boolean;
	activeRelationship?: boolean;
	personProtected?: boolean;
	organizationProtected?: boolean;
	playerProtected?: boolean;
	contactOnceClaimed?: boolean;
	activeOrganizationOpportunityCount?: number;
	organizationDensityLimit?: number;
	language?: CommercialLanguageInput;
	careerStage?: CommercialRating;
	momentum?: CommercialRating;
	mediaGap?: CommercialRating;
	iblFit?: CommercialRating;
	mediaSophistication?: CommercialRating;
	agencyLeverage?: CommercialRating;
	decisionMakerQuality?: CommercialRating;
	accessibility?: CommercialRating;
	evidenceFreshness?: CommercialRating;
	opportunityDistinctness?: CommercialRating;
	hookStrength?: CommercialRating;
	scarceSlotWorthiness?: CommercialRating;
};

export type CommercialQualityResult = {
	status: CommercialQualityStatus;
	score: number;
	collisionKey: string;
	organizationKey: string;
	reasons: CommercialQualityReason[];
	language: CommercialLanguageRoute;
};

const LANGUAGE_NAMES: Record<string, CommercialLanguage> = {
	english: "English",
	en: "English",
	dutch: "Dutch",
	nl: "Dutch",
	nederlands: "Dutch",
	turkish: "Turkish",
	tr: "Turkish",
	türkçe: "Turkish",
};

const QUALITY_DIMENSIONS = [
	[
		"careerStage",
		"CAREER_STAGE_MISSING",
		"Career stage or runway evidence is missing.",
	],
	[
		"momentum",
		"MOMENTUM_EVIDENCE_MISSING",
		"Current momentum or a credible why-now signal is missing.",
	],
	[
		"mediaGap",
		"MEDIA_GAP_EVIDENCE_MISSING",
		"A specific media gap is not evidenced.",
	],
	["iblFit", "IBL_FIT_EVIDENCE_MISSING", "Realistic IBL fit is not evidenced."],
	[
		"mediaSophistication",
		"MEDIA_SOPHISTICATION_EVIDENCE_MISSING",
		"Media sophistication evidence is missing.",
	],
	[
		"agencyLeverage",
		"AGENCY_LEVERAGE_EVIDENCE_MISSING",
		"Agency leverage or route-to-decision-maker evidence is missing.",
	],
	[
		"decisionMakerQuality",
		"DECISION_MAKER_EVIDENCE_MISSING",
		"Decision-maker quality is not evidenced.",
	],
	[
		"accessibility",
		"ACCESSIBILITY_EVIDENCE_MISSING",
		"Contact accessibility is not evidenced.",
	],
	[
		"evidenceFreshness",
		"EVIDENCE_FRESHNESS_MISSING",
		"Evidence freshness is not recorded.",
	],
	[
		"opportunityDistinctness",
		"OPPORTUNITY_DISTINCTNESS_MISSING",
		"Opportunity distinctness is not evidenced.",
	],
	[
		"hookStrength",
		"HOOK_STRENGTH_MISSING",
		"The hook is not strong enough or not evidenced.",
	],
	[
		"scarceSlotWorthiness",
		"SCARCE_SLOT_WORTHINESS_MISSING",
		"Scarce-slot worthiness is not evidenced.",
	],
] as const;

function normalize(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

export function normalizeCommercialKeyPart(value: string): string {
	return normalize(value);
}

export function opportunityCollisionKey(input: {
	organization: string;
	playerOrOpportunity: string;
	campaignPurpose: string;
}): string {
	return [input.organization, input.playerOrOpportunity, input.campaignPurpose]
		.map(normalize)
		.join("::");
}

function languageFromValue(
	value: string | null | undefined,
): CommercialLanguage | null {
	if (!value) return null;
	const normalized = value.trim().toLowerCase();
	return (
		LANGUAGE_NAMES[normalized] ??
		(normalized.match(/\b(?:dutch|nederlands|nederlandstalig)\b/)
			? "Dutch"
			: null) ??
		(normalized.match(/\b(?:turkish|türkçe|turkçe)\b/) ? "Turkish" : null) ??
		null
	);
}

export function routeCommercialLanguage(
	input: CommercialLanguageInput,
): CommercialLanguageRoute {
	const evidence: string[] = [];
	const explicit = [
		input.profileLanguage,
		...(input.profileLanguages ?? []),
		...(input.languageSignals ?? []),
	]
		.map((value) => ({ value, language: languageFromValue(value) }))
		.filter(
			(item): item is { value: string; language: CommercialLanguage } =>
				item.language !== null,
		);
	const counts = new Map<CommercialLanguage, number>();
	for (const item of explicit) {
		counts.set(item.language, (counts.get(item.language) ?? 0) + 1);
		evidence.push(`explicit language evidence: ${item.value}`);
	}
	const winner = [...counts.entries()].sort(
		(left, right) => right[1] - left[1],
	)[0];
	if (winner && winner[1] > 0) {
		return {
			language: winner[0],
			confidence: winner[1] > 1 ? "HIGH" : "MEDIUM",
			evidence,
			reason:
				"The selected language is supported by explicit profile or source evidence.",
		};
	}
	const domain = input.organizationDomain?.trim().toLowerCase() ?? "";
	const organization = normalize(input.organizationName ?? "");
	if (/\b(?:vision4soccer|vvcs)\b/.test(organization)) {
		return {
			language: "Dutch",
			confidence: "MEDIUM",
			evidence: [
				`known Dutch football organization: ${input.organizationName}`,
			],
			reason:
				"The organization is a known Dutch football agency or association, so Dutch is the default route.",
		};
	}
	if (domain.endsWith(".nl")) {
		return {
			language: "English",
			confidence: "MEDIUM",
			evidence: ["organization domain ends in .nl"],
			reason:
				"The domain is a Dutch signal but is insufficient by itself to select Dutch copy.",
		};
	}
	return {
		language: "English",
		confidence: "LOW",
		evidence: [],
		reason:
			"No reliable Dutch or Turkish language evidence was found; English is the safe fallback.",
	};
}

function ratingValue(value: CommercialRating | undefined): number {
	if (value === "HIGH") return 10;
	if (value === "MEDIUM") return 6;
	if (value === "LOW") return 2;
	return 0;
}

function isMissing(value: CommercialRating | undefined): boolean {
	return value === undefined || value === "UNKNOWN";
}

function hasMissingEvidence(input: CommercialQualityInput): boolean {
	return QUALITY_DIMENSIONS.some(([field]) => isMissing(input[field]));
}

function hasMissingCoreEvidence(input: CommercialQualityInput): boolean {
	return QUALITY_DIMENSIONS.some(
		([field]) =>
			COMMERCIAL_CORE_DIMENSIONS.has(field) && isMissing(input[field]),
	);
}

function currentClubRequired(input: CommercialQualityInput): boolean {
	return (
		input.currentClubRequired ??
		Boolean(
			input.copyReferencesCurrentClub ||
				input.whyNowRequiresClub ||
				input.associationRequiresClub,
		)
	);
}

function reason(
	code: CommercialQualityReasonCode,
	message: string,
): CommercialQualityReason {
	return { code, message };
}

function addSubjectBodyFailure(
	input: CommercialQualityInput,
	reasons: CommercialQualityReason[],
): void {
	if (input.subjectBodyAligned === false) {
		reasons.push(
			reason(
				"SUBJECT_BODY_MISMATCH",
				"The subject and body do not describe the same opportunity.",
			),
		);
	}
	if (input.subject?.trim() && input.body?.trim()) {
		const player = normalize(input.playerOrOpportunity);
		const playerTokens = player.split(" ").filter((token) => token.length > 3);
		const copy = normalize(`${input.subject} ${input.body}`);
		if (
			playerTokens.length > 0 &&
			!playerTokens.some((token) => copy.includes(token))
		) {
			reasons.push(
				reason(
					"SUBJECT_BODY_MISMATCH",
					"The player or opportunity is absent from the proposed copy.",
				),
			);
		}
	}
}

export function evaluateCommercialQuality(
	input: CommercialQualityInput,
): CommercialQualityResult {
	const collisionKey = opportunityCollisionKey(input);
	const organizationKey = normalize(input.organization);
	const language = routeCommercialLanguage(input.language ?? {});
	const reasons: CommercialQualityReason[] = [];
	const add = (code: CommercialQualityReasonCode, message: string) => {
		if (!reasons.some((item) => item.code === code))
			reasons.push(reason(code, message));
	};

	if (input.personProtected)
		add(
			"PERSON_OWNER_PROTECTED",
			"The person is protected by an owner override.",
		);
	if (input.organizationProtected)
		add(
			"ORGANIZATION_PROTECTED",
			"The organization is protected by an owner override.",
		);
	if (input.playerProtected)
		add(
			"PLAYER_PROTECTED",
			"The player is protected from prospecting outreach.",
		);
	if (input.activeRelationship)
		add(
			"ACTIVE_RELATIONSHIP",
			"An active relationship requires human coordination.",
		);
	if (input.contactOnceClaimed)
		add(
			"CONTACT_ONCE_ALREADY_CLAIMED",
			"The contact already has a cross-channel cold-touch claim.",
		);
	if (input.opportunityAlreadyActive)
		add(
			"OPPORTUNITY_ALREADY_ACTIVE",
			"The same commercial opportunity is already active.",
		);
	if (
		(input.activeOrganizationOpportunityCount ?? 0) >=
		(input.organizationDensityLimit ?? COMMERCIAL_ORGANIZATION_DENSITY_LIMIT)
	) {
		add(
			"ORGANIZATION_DENSITY_LIMIT",
			"The organization has reached the active distinct-opportunity density limit.",
		);
	}
	if (input.routeOpportunityConflict)
		add(
			"ROUTE_OPPORTUNITY_CONFLICT",
			"The route or mailbox conflicts with the opportunity policy.",
		);
	if (
		input.identityResolved === false ||
		!normalize(input.playerOrOpportunity)
	) {
		add(
			"MALFORMED_PLAYER_IDENTITY",
			"The player or opportunity identity is unresolved.",
		);
	}
	if (input.organizationResolved === false || !organizationKey) {
		add("UNRESOLVED_ORGANIZATION", "The organization is unresolved.");
	}
	if (input.playerOrganizationAssociationResolved === false) {
		add(
			"UNRESOLVED_PLAYER_ORGANIZATION_ASSOCIATION",
			"The player-to-organization association is unresolved.",
		);
	}
	if (
		input.placeholderHook ||
		/\bclient roster\b|\btbd\b|\bunknown player\b/i.test(
			input.playerOrOpportunity,
		)
	) {
		add(
			"PLACEHOLDER_HOOK",
			"The hook uses a placeholder rather than an identified opportunity.",
		);
	}
	if (input.fabricatedOrContradictedHook) {
		add(
			"FABRICATED_OR_CONTRADICTED_HOOK",
			"The proposed hook is fabricated or contradicted by the available evidence.",
		);
	}
	if (
		currentClubRequired(input) &&
		(!input.currentClub?.trim() || input.currentClubVerified === false)
	) {
		add(
			"CURRENT_CLUB_UNVERIFIED",
			"The current club is required for this hook but is absent or unverified.",
		);
	}
	if ((input.whyNowRequired ?? false) && input.whyNowSupported !== true)
		add(
			"WHY_NOW_UNSUPPORTED",
			"The why-now claim is not supported by current evidence.",
		);
	if (
		/\{\{|\}\}|<\/?[A-Z_]+>|\[\[[A-Z_]+\]\]/.test(
			`${input.subject ?? ""}\n${input.body ?? ""}`,
		)
	) {
		add(
			"UNRESOLVED_TEMPLATE_TOKENS",
			"The proposed copy contains unresolved template tokens.",
		);
	}
	addSubjectBodyFailure(input, reasons);
	if (input.requestedLanguage) {
		const requested = languageFromValue(input.requestedLanguage);
		if (
			requested &&
			requested !== language.language &&
			language.confidence === "HIGH"
		) {
			add(
				"LANGUAGE_ROUTING_CONFLICT",
				"The requested copy language conflicts with high-confidence language evidence.",
			);
		}
	}

	const scoredValues = QUALITY_DIMENSIONS.filter(
		([field]) => !isMissing(input[field]),
	).map(([field]) => ratingValue(input[field]));
	if (currentClubRequired(input))
		scoredValues.push(input.currentClubVerified ? 10 : 0);
	else if (input.currentClubVerified) scoredValues.push(10);
	if (input.whyNowRequired || input.whyNowSupported === true)
		scoredValues.push(input.whyNowSupported ? 10 : 0);
	const score =
		scoredValues.length === 0
			? 0
			: Math.round(
					(scoredValues.reduce((total, value) => total + value, 0) /
						scoredValues.length) *
						10,
				);

	if (
		reasons.some((item) =>
			[
				"PERSON_OWNER_PROTECTED",
				"ORGANIZATION_PROTECTED",
				"PLAYER_PROTECTED",
			].includes(item.code),
		)
	) {
		return {
			status: "BLOCK_PROTECTION",
			score,
			collisionKey,
			organizationKey,
			reasons,
			language,
		};
	}
	if (reasons.some((item) => item.code === "ACTIVE_RELATIONSHIP")) {
		return {
			status: "BLOCK_ACTIVE_RELATIONSHIP",
			score,
			collisionKey,
			organizationKey,
			reasons,
			language,
		};
	}
	if (reasons.some((item) => item.code === "CONTACT_ONCE_ALREADY_CLAIMED")) {
		return {
			status: "BLOCK_CONTACT_ONCE",
			score,
			collisionKey,
			organizationKey,
			reasons,
			language,
		};
	}
	if (
		reasons.some((item) =>
			["OPPORTUNITY_ALREADY_ACTIVE", "ORGANIZATION_DENSITY_LIMIT"].includes(
				item.code,
			),
		)
	) {
		return {
			status: "BLOCK_DUPLICATE_OPPORTUNITY",
			score,
			collisionKey,
			organizationKey,
			reasons,
			language,
		};
	}
	const hardFailures = reasons.filter(
		(item) =>
			!item.code.endsWith("_MISSING") && item.code !== "LOW_COMMERCIAL_QUALITY",
	);
	if (hardFailures.length > 0) {
		return {
			status: "HOLD_NEEDS_ENRICHMENT",
			score,
			collisionKey,
			organizationKey,
			reasons,
			language,
		};
	}
	if (hasMissingEvidence(input)) {
		for (const [field, code, message] of QUALITY_DIMENSIONS) {
			if (input[field] === undefined || input[field] === "UNKNOWN")
				add(code, message);
		}
		if (
			!input.language?.profileLanguage &&
			!input.language?.profileLanguages?.length &&
			!input.language?.languageSignals?.length
		) {
			add(
				"LANGUAGE_EVIDENCE_MISSING",
				"Language evidence is missing; English fallback is selected.",
			);
		}
		if (hasMissingCoreEvidence(input)) {
			return {
				status: "HOLD_NEEDS_ENRICHMENT",
				score,
				collisionKey,
				organizationKey,
				reasons,
				language,
			};
		}
	}
	if (score < COMMERCIAL_QUALITY_SENDABLE_THRESHOLD) {
		add(
			"LOW_COMMERCIAL_QUALITY",
			"The opportunity does not justify a scarce outbound slot on the current evidence.",
		);
		return {
			status: "BLOCK_LOW_COMMERCIAL_QUALITY",
			score,
			collisionKey,
			organizationKey,
			reasons,
			language,
		};
	}
	return {
		status: "SENDABLE",
		score,
		collisionKey,
		organizationKey,
		reasons,
		language,
	};
}

export type CommercialOpportunityRankEntry = {
	id: string;
	collisionKey: string;
	score: number;
	organizationKey?: string;
};

export function rankCommercialOpportunities<
	T extends CommercialOpportunityRankEntry,
>(entries: readonly T[]): T[] {
	return [...entries].sort(
		(left, right) =>
			right.score - left.score ||
			(left.organizationKey ?? "").localeCompare(right.organizationKey ?? "") ||
			left.collisionKey.localeCompare(right.collisionKey) ||
			left.id.localeCompare(right.id),
	);
}
