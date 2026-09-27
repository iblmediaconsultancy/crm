import { describe, expect, it } from "bun:test";
import {
	evaluateCommercialQuality,
	opportunityCollisionKey,
	rankCommercialOpportunities,
	routeCommercialLanguage,
} from "../src/commercial-quality";

const strongEvidence = {
	organization: "IFM-M",
	playerOrOpportunity: "Alexandr Sojka",
	campaignPurpose: "player media support",
	currentClub: "FC Viktoria Plzen",
	currentClubVerified: true,
	currentClubRequired: true,
	identityResolved: true,
	organizationResolved: true,
	playerOrganizationAssociationResolved: true,
	whyNowSupported: true,
	language: { profileLanguage: "English" },
	careerStage: "HIGH" as const,
	momentum: "HIGH" as const,
	mediaGap: "HIGH" as const,
	iblFit: "HIGH" as const,
	mediaSophistication: "HIGH" as const,
	agencyLeverage: "HIGH" as const,
	decisionMakerQuality: "HIGH" as const,
	accessibility: "HIGH" as const,
	evidenceFreshness: "HIGH" as const,
	opportunityDistinctness: "HIGH" as const,
	hookStrength: "HIGH" as const,
	scarceSlotWorthiness: "HIGH" as const,
	subject: "Alexandr Sojka at FC Viktoria Plzen",
	body: "Alexandr Sojka has a timely media opportunity at FC Viktoria Plzen.",
};

describe("commercial quality gate", () => {
	it("normalizes collision variants across contacts, routes, and mailbox labels", () => {
		expect(
			opportunityCollisionKey({
				organization: "IFM–M",
				playerOrOpportunity: "Alexandr Sojka",
				campaignPurpose: "Player media support",
			}),
		).toBe(
			opportunityCollisionKey({
				organization: "ifm-m",
				playerOrOpportunity: "Alexandr Sojka",
				campaignPurpose: "player media support",
			}),
		);
	});

	it("routes Dutch, Turkish, and safe English fallback from evidence", () => {
		expect(
			routeCommercialLanguage({
				profileLanguage: "Nederlands",
				languageSignals: ["Dutch agency profile"],
			}),
		).toMatchObject({ language: "Dutch", confidence: "HIGH" });
		expect(
			routeCommercialLanguage({ profileLanguage: "Türkçe" }),
		).toMatchObject({ language: "Turkish", confidence: "MEDIUM" });
		expect(
			routeCommercialLanguage({ organizationDomain: "example.nl" }),
		).toMatchObject({ language: "English", confidence: "MEDIUM" });
		expect(
			routeCommercialLanguage({ organizationName: "Vision4Soccer" }),
		).toMatchObject({ language: "Dutch", confidence: "MEDIUM" });
		expect(routeCommercialLanguage({})).toMatchObject({
			language: "English",
			confidence: "LOW",
		});
	});

	it("does not require a current club or timely event for a strong general opportunity", () => {
		const result = evaluateCommercialQuality({
			...strongEvidence,
			currentClub: null,
			currentClubVerified: false,
			currentClubRequired: false,
			whyNowSupported: false,
			whyNowRequired: false,
			copyReferencesCurrentClub: false,
			subject: "A focused media opportunity for IFM-M",
			body: "Alexandr Sojka has a clear media opportunity that does not depend on a current club or a time-sensitive event.",
		});
		expect(result.status).toBe("SENDABLE");
		expect(result.reasons).not.toContainEqual(
			expect.objectContaining({ code: "CURRENT_CLUB_UNVERIFIED" }),
		);
		expect(result.reasons).not.toContainEqual(
			expect.objectContaining({ code: "WHY_NOW_UNSUPPORTED" }),
		);
	});

	it("keeps club-specific and unsupported why-now copy recoverable", () => {
		const clubSpecific = evaluateCommercialQuality({
			...strongEvidence,
			currentClub: null,
			currentClubVerified: false,
			currentClubRequired: true,
		});
		const timely = evaluateCommercialQuality({
			...strongEvidence,
			whyNowSupported: false,
			whyNowRequired: true,
		});
		expect(clubSpecific.status).toBe("HOLD_NEEDS_ENRICHMENT");
		expect(timely.status).toBe("HOLD_NEEDS_ENRICHMENT");
	});

	it("allows a high-quality opportunity and is deterministic on rerun", () => {
		const first = evaluateCommercialQuality(strongEvidence);
		const second = evaluateCommercialQuality(strongEvidence);
		expect(first.status).toBe("SENDABLE");
		expect(first.score).toBeGreaterThanOrEqual(70);
		expect(second).toEqual(first);
	});

	it("holds missing current club, unresolved identity, placeholders, and weak why-now", () => {
		expect(
			evaluateCommercialQuality({ ...strongEvidence, currentClub: null })
				.reasons,
		).toContainEqual(
			expect.objectContaining({ code: "CURRENT_CLUB_UNVERIFIED" }),
		);
		expect(
			evaluateCommercialQuality({ ...strongEvidence, identityResolved: false })
				.status,
		).toBe("HOLD_NEEDS_ENRICHMENT");
		expect(
			evaluateCommercialQuality({
				...strongEvidence,
				playerOrOpportunity: "Client Roster",
			}).reasons,
		).toContainEqual(expect.objectContaining({ code: "PLACEHOLDER_HOOK" }));
		expect(
			evaluateCommercialQuality({
				...strongEvidence,
				whyNowSupported: false,
				whyNowRequired: true,
			}).status,
		).toBe("HOLD_NEEDS_ENRICHMENT");
	});

	it("blocks an established player when the commercial need is weak", () => {
		const result = evaluateCommercialQuality({
			...strongEvidence,
			careerStage: "HIGH",
			momentum: "LOW",
			mediaGap: "LOW",
			iblFit: "LOW",
			mediaSophistication: "LOW",
			agencyLeverage: "LOW",
			decisionMakerQuality: "LOW",
			accessibility: "LOW",
			evidenceFreshness: "LOW",
			opportunityDistinctness: "LOW",
			hookStrength: "LOW",
			scarceSlotWorthiness: "LOW",
		});
		expect(result.status).toBe("BLOCK_LOW_COMMERCIAL_QUALITY");
		expect(result.reasons).toContainEqual(
			expect.objectContaining({ code: "LOW_COMMERCIAL_QUALITY" }),
		);
	});

	it("blocks duplicate opportunities, organization flooding, and protected routes", () => {
		expect(
			evaluateCommercialQuality({
				...strongEvidence,
				opportunityAlreadyActive: true,
			}).status,
		).toBe("BLOCK_DUPLICATE_OPPORTUNITY");
		expect(
			evaluateCommercialQuality({
				...strongEvidence,
				activeOrganizationOpportunityCount: 2,
			}).status,
		).toBe("BLOCK_DUPLICATE_OPPORTUNITY");
		expect(
			evaluateCommercialQuality({ ...strongEvidence, personProtected: true })
				.status,
		).toBe("BLOCK_PROTECTION");
		expect(
			evaluateCommercialQuality({ ...strongEvidence, contactOnceClaimed: true })
				.status,
		).toBe("BLOCK_CONTACT_ONCE");
	});

	it("ranks actual opportunities before contact or route tie-breakers", () => {
		const ranked = rankCommercialOpportunities([
			{
				id: "route-b",
				collisionKey: "org::player-b::purpose",
				organizationKey: "org",
				score: 72,
			},
			{
				id: "route-a",
				collisionKey: "org::player-a::purpose",
				organizationKey: "org",
				score: 91,
			},
			{
				id: "route-c",
				collisionKey: "other::player::purpose",
				organizationKey: "other",
				score: 91,
			},
		]);
		expect(ranked.map((entry) => entry.id)).toEqual([
			"route-a",
			"route-c",
			"route-b",
		]);
	});
});
