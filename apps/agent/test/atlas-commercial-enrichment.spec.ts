import { describe, expect, it } from "bun:test";
import {
	type CommercialQualityInput,
	evaluateCommercialQuality,
} from "@crm/db";
import {
	ATLAS_COMMERCIAL_ENRICHMENT_MAX_ATTEMPTS,
	canRetryCommercialQuality,
	commercialQualityUpdateData,
} from "../agent/lib/atlas-commercial-enrichment";

const coreEvidence: CommercialQualityInput = {
	organization: "IFM-M",
	playerOrOpportunity: "Alexandr Sojka",
	campaignPurpose: "player media support",
	identityResolved: true,
	organizationResolved: true,
	playerOrganizationAssociationResolved: true,
	mediaGap: "HIGH",
	iblFit: "HIGH",
	agencyLeverage: "HIGH",
	decisionMakerQuality: "HIGH",
	opportunityDistinctness: "HIGH",
	hookStrength: "HIGH",
};

describe("Atlas commercial enrichment loop", () => {
	it("retries recoverable evidence gaps but not fabricated hooks", () => {
		const recoverable = evaluateCommercialQuality({
			...coreEvidence,
			currentClubRequired: true,
			currentClubVerified: false,
		});
		const fabricated = evaluateCommercialQuality({
			...coreEvidence,
			fabricatedOrContradictedHook: true,
		});
		expect(canRetryCommercialQuality(recoverable)).toBe(true);
		expect(canRetryCommercialQuality(fabricated)).toBe(false);
		expect(ATLAS_COMMERCIAL_ENRICHMENT_MAX_ATTEMPTS).toBe(3);
	});

	it("persists a deterministic reevaluation payload without sending", () => {
		const result = evaluateCommercialQuality(coreEvidence);
		const data = commercialQualityUpdateData(
			result,
			new Date("2026-09-24T12:00:00Z"),
			coreEvidence,
		);
		expect(data.commercialQualityStatus).toBe("SENDABLE");
		expect(data.commercialQualityInput).toEqual(coreEvidence);
		expect(data.commercialQualityScore).toBeGreaterThanOrEqual(70);
	});
});
