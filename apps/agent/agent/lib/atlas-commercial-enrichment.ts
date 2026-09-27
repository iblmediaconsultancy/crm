import {
	COMMERCIAL_ENRICHMENT_MAX_ATTEMPTS,
	type CommercialQualityInput,
	type CommercialQualityResult,
	db,
	evaluateCommercialQuality,
	type Prisma,
} from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import { attribute, type PurposeContext, purposeOf } from "./session-purpose";
import { scheduleTask } from "./tasks";

export const ATLAS_COMMERCIAL_ENRICHMENT_KIND = "atlas-commercial-enrichment";
export {
	COMMERCIAL_ENRICHMENT_MAX_ATTEMPTS as ATLAS_COMMERCIAL_ENRICHMENT_MAX_ATTEMPTS,
};

type EnrichmentConfidence = "HIGH" | "MEDIUM" | "LOW";

export type AtlasCommercialEvidence = {
	field: string;
	summary: string;
	sourceUrl: string;
	confidence: EnrichmentConfidence;
};

export type AtlasCommercialEnrichmentInput = {
	leadId: string;
	evidence: AtlasCommercialEvidence[];
	currentClub?: {
		value: string;
		sourceUrl: string;
		confidence: EnrichmentConfidence;
	};
	whyNow?: {
		supported: boolean;
		summary: string;
		sourceUrl?: string;
		confidence: EnrichmentConfidence;
	};
	language?: {
		profileLanguage?: string;
		languageSignals?: string[];
		organizationDomain?: string;
		organizationName?: string;
	};
	ratings?: Partial<
		Pick<
			CommercialQualityInput,
			| "careerStage"
			| "momentum"
			| "mediaGap"
			| "iblFit"
			| "mediaSophistication"
			| "agencyLeverage"
			| "decisionMakerQuality"
			| "accessibility"
			| "evidenceFreshness"
			| "opportunityDistinctness"
			| "hookStrength"
			| "scarceSlotWorthiness"
		>
	>;
};

function assertEnrichmentContext(ctx: PurposeContext, leadId: string): void {
	if (purposeOf(ctx) !== "atlas-commercial-enrichment")
		throw new Error("This action is available only to Atlas enrichment runs.");
	if (attribute(ctx, "taskKind") !== ATLAS_COMMERCIAL_ENRICHMENT_KIND)
		throw new Error(
			"This action is available only to dispatched Atlas enrichment tasks.",
		);
	if (attribute(ctx, "leadId") !== leadId)
		throw new Error("The lead is outside this enrichment task.");
}

function asJson(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function mergeQualityInput(
	base: CommercialQualityInput,
	input: AtlasCommercialEnrichmentInput,
): CommercialQualityInput {
	return {
		...base,
		...(input.currentClub
			? {
					currentClub: input.currentClub.value,
					currentClubVerified: true,
				}
			: {}),
		...(input.whyNow ? { whyNowSupported: input.whyNow.supported } : {}),
		...(input.ratings ?? {}),
		language: {
			...(base.language ?? {}),
			...(input.language ?? {}),
		},
	};
}

export function commercialQualityUpdateData(
	result: CommercialQualityResult,
	evaluatedAt: Date,
	input: CommercialQualityInput,
) {
	return {
		commercialQualityStatus: result.status,
		commercialQualityReasons: asJson(result.reasons),
		commercialQualityScore: result.score,
		commercialOpportunityCollisionKey: result.collisionKey || null,
		commercialQualityEvaluatedAt: evaluatedAt,
		commercialLanguage: result.language.language,
		commercialLanguageConfidence: result.language.confidence,
		commercialLanguageEvidence: asJson(result.language.evidence),
		commercialQualityInput: asJson(input),
	};
}

function highestConfidence(
	evidence: AtlasCommercialEvidence[],
): EnrichmentConfidence | null {
	if (evidence.some((item) => item.confidence === "HIGH")) return "HIGH";
	if (evidence.some((item) => item.confidence === "MEDIUM")) return "MEDIUM";
	if (evidence.some((item) => item.confidence === "LOW")) return "LOW";
	return null;
}

export function canRetryCommercialQuality(
	result: CommercialQualityResult,
): boolean {
	return (
		result.status === "HOLD_NEEDS_ENRICHMENT" &&
		result.reasons.some((item) =>
			[
				"CURRENT_CLUB_UNVERIFIED",
				"WHY_NOW_UNSUPPORTED",
				"LANGUAGE_EVIDENCE_MISSING",
				"CAREER_STAGE_MISSING",
				"MOMENTUM_EVIDENCE_MISSING",
				"MEDIA_GAP_EVIDENCE_MISSING",
				"IBL_FIT_EVIDENCE_MISSING",
				"MEDIA_SOPHISTICATION_EVIDENCE_MISSING",
				"AGENCY_LEVERAGE_EVIDENCE_MISSING",
				"DECISION_MAKER_EVIDENCE_MISSING",
				"ACCESSIBILITY_EVIDENCE_MISSING",
				"EVIDENCE_FRESHNESS_MISSING",
				"OPPORTUNITY_DISTINCTNESS_MISSING",
				"HOOK_STRENGTH_MISSING",
				"SCARCE_SLOT_WORTHINESS_MISSING",
				"MALFORMED_PLAYER_IDENTITY",
				"UNRESOLVED_ORGANIZATION",
				"UNRESOLVED_PLAYER_ORGANIZATION_ASSOCIATION",
			].includes(item.code),
		)
	);
}

export async function recordAtlasCommercialEnrichment(
	ctx: PurposeContext,
	input: AtlasCommercialEnrichmentInput,
) {
	assertEnrichmentContext(ctx, input.leadId);
	return withPrincipal(db, { userId: null, kind: "worker" }, async (tx) => {
		const lead = await tx.lead.findUnique({
			where: { id: input.leadId },
			select: {
				id: true,
				commercialQualityStatus: true,
				commercialQualityScore: true,
				commercialQualityInput: true,
				commercialEnrichmentAttempts: true,
				commercialEnrichmentEvidence: true,
				commercialEnrichmentStatus: true,
				commercialEnrichmentConfidence: true,
				commercialEnrichmentNextAttemptAt: true,
			},
		});
		if (!lead?.commercialQualityInput)
			throw new Error("The lead has no persisted commercial-quality input.");
		if (
			lead.commercialEnrichmentStatus === "RESOLVED" ||
			lead.commercialEnrichmentStatus === "EXHAUSTED"
		) {
			return {
				id: lead.id,
				commercialQualityStatus: lead.commercialQualityStatus,
				commercialQualityScore: lead.commercialQualityScore,
				commercialEnrichmentStatus: lead.commercialEnrichmentStatus,
				commercialEnrichmentAttempts: lead.commercialEnrichmentAttempts,
				commercialEnrichmentNextAttemptAt:
					lead.commercialEnrichmentNextAttemptAt,
			};
		}

		const base = lead.commercialQualityInput as CommercialQualityInput;
		const merged = mergeQualityInput(base, input);
		const now = new Date();
		const result = evaluateCommercialQuality(merged);
		const attempts = lead.commercialEnrichmentAttempts + 1;
		const retry =
			canRetryCommercialQuality(result) &&
			attempts < COMMERCIAL_ENRICHMENT_MAX_ATTEMPTS;
		const observedEvidence: AtlasCommercialEvidence[] = [
			...input.evidence,
			...(input.currentClub
				? [
						{
							field: "currentClub",
							summary: `Current club observed as ${input.currentClub.value}.`,
							sourceUrl: input.currentClub.sourceUrl,
							confidence: input.currentClub.confidence,
						},
					]
				: []),
			...(input.whyNow?.sourceUrl
				? [
						{
							field: "whyNow",
							summary: input.whyNow.summary,
							sourceUrl: input.whyNow.sourceUrl,
							confidence: input.whyNow.confidence,
						},
					]
				: []),
		];
		const evidence = [
			...(Array.isArray(lead.commercialEnrichmentEvidence)
				? lead.commercialEnrichmentEvidence
				: []),
			...observedEvidence.map((item) => ({
				...item,
				capturedAt: now.toISOString(),
			})),
		];
		const persisted = await tx.lead.update({
			where: { id: lead.id },
			data: {
				...commercialQualityUpdateData(result, now, merged),
				commercialEnrichmentStatus:
					result.status === "SENDABLE"
						? "RESOLVED"
						: retry
							? "QUEUED"
							: "EXHAUSTED",
				commercialEnrichmentReason: result.reasons
					.map((item) => item.code)
					.join(",")
					.slice(0, 500),
				commercialEnrichmentAttempts: attempts,
				commercialEnrichmentEvidence: asJson(evidence),
				commercialEnrichmentConfidence:
					highestConfidence(observedEvidence) ??
					lead.commercialEnrichmentConfidence,
				commercialEnrichmentNextAttemptAt: retry
					? new Date(now.getTime() + attempts * 15 * 60_000)
					: null,
				commercialEnrichmentEvaluatedAt: now,
				commercialEnrichmentResult: asJson({
					status: result.status,
					score: result.score,
					reasons: result.reasons,
				}),
			},
			select: {
				id: true,
				commercialQualityStatus: true,
				commercialQualityScore: true,
				commercialEnrichmentStatus: true,
				commercialEnrichmentAttempts: true,
				commercialEnrichmentNextAttemptAt: true,
			},
		});
		return persisted;
	});
}

export async function scheduleDueAtlasCommercialEnrichment(): Promise<number> {
	const now = new Date();
	const leads = await db.lead.findMany({
		where: {
			commercialQualityStatus: "HOLD_NEEDS_ENRICHMENT",
			commercialEnrichmentStatus: "QUEUED",
			commercialEnrichmentNextAttemptAt: { lte: now },
			commercialEnrichmentAttempts: { lt: COMMERCIAL_ENRICHMENT_MAX_ATTEMPTS },
		},
		select: {
			id: true,
			contactId: true,
			companyId: true,
			commercialEnrichmentReason: true,
		},
		take: 20,
	});
	await Promise.all(
		leads.map((lead) =>
			scheduleTask({
				leadId: lead.id,
				contactId: lead.contactId,
				companyId: lead.companyId,
				kind: ATLAS_COMMERCIAL_ENRICHMENT_KIND,
				reason: `Recover missing Atlas commercial evidence: ${lead.commercialEnrichmentReason ?? "quality gate hold"}`,
				dueAt: now,
				priority: 85,
				budget: 4,
			}),
		),
	);
	return leads.length;
}
