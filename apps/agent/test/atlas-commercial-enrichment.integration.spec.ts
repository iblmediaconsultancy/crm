import { afterAll, describe, expect, it } from "bun:test";
import { type CommercialQualityInput, db, type Prisma } from "@crm/db";
import {
	type AtlasCommercialEnrichmentInput,
	recordAtlasCommercialEnrichment,
} from "../agent/lib/atlas-commercial-enrichment";

const testDatabaseUrl =
	process.env.ATLAS_COMMERCIAL_ENRICHMENT_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
	describe.skip("Atlas commercial enrichment database integration", () => {});
} else {
	const suffix = crypto.randomUUID();
	const contactId = `atlas-enrichment-contact-${suffix}`;
	const leadId = `atlas-enrichment-lead-${suffix}`;

	const context = {
		session: {
			auth: {
				current: {
					attributes: {
						purpose: "atlas-commercial-enrichment",
						taskKind: "atlas-commercial-enrichment",
						leadId,
					},
				},
				initiator: null,
			},
		},
	};

	const base: CommercialQualityInput = {
		organization: "IFM-M",
		playerOrOpportunity: "Alexandr Sojka",
		campaignPurpose: "player media support",
		currentClub: null,
		currentClubVerified: false,
		currentClubRequired: true,
		identityResolved: true,
		organizationResolved: true,
		playerOrganizationAssociationResolved: true,
		whyNowRequired: false,
		subject: "Alexandr Sojka at a new club",
		body: "Alexandr Sojka has a focused media opportunity.",
		mediaGap: "HIGH",
		iblFit: "HIGH",
		agencyLeverage: "HIGH",
		decisionMakerQuality: "HIGH",
		opportunityDistinctness: "HIGH",
		hookStrength: "HIGH",
	};

	const enrichment: AtlasCommercialEnrichmentInput = {
		leadId,
		evidence: [
			{
				field: "currentClub",
				summary: "The club is stated on the player's current public profile.",
				sourceUrl: "https://example.invalid/player-profile",
				confidence: "HIGH",
			},
		],
		currentClub: {
			value: "FC Viktoria Plzen",
			sourceUrl: "https://example.invalid/player-profile",
			confidence: "HIGH",
		},
	};

	describe("Atlas commercial enrichment database integration", () => {
		it("reevaluates once and is idempotent without creating outreach artifacts", async () => {
			const user = await db.user.findFirst({ select: { id: true } });
			if (!user) throw new Error("A disposable CRM clone needs one user.");
			await db.contact.create({
				data: { id: contactId, firstName: "Alexandr" },
			});
			await db.lead.create({
				data: {
					id: leadId,
					name: "Alexandr Sojka",
					contactId,
					ownerUserId: user.id,
					createdByUserId: user.id,
					commercialQualityStatus: "HOLD_NEEDS_ENRICHMENT",
					commercialQualityInput: base as Prisma.InputJsonValue,
					commercialEnrichmentStatus: "QUEUED",
				},
			});

			const first = await recordAtlasCommercialEnrichment(context, enrichment);
			const second = await recordAtlasCommercialEnrichment(context, enrichment);
			const lead = await db.lead.findUnique({
				where: { id: leadId },
				select: {
					commercialQualityStatus: true,
					commercialEnrichmentStatus: true,
					commercialEnrichmentAttempts: true,
				},
			});
			expect(first.commercialQualityStatus).toBe("SENDABLE");
			expect(second).toEqual(first);
			expect(lead).toEqual({
				commercialQualityStatus: "SENDABLE",
				commercialEnrichmentStatus: "RESOLVED",
				commercialEnrichmentAttempts: 1,
			});
			expect(await db.draft.count({ where: { leadId } })).toBe(0);
		});
	});

	afterAll(async () => {
		await db.lead.deleteMany({ where: { id: leadId } });
		await db.contact.deleteMany({ where: { id: contactId } });
		await db.$disconnect();
	});
}
