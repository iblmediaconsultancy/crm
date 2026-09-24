import { defineTool } from "eve/tools";
import { z } from "zod";
import {
	type AtlasCommercialEnrichmentInput,
	recordAtlasCommercialEnrichment,
} from "../lib/atlas-commercial-enrichment";

const confidence = z.enum(["HIGH", "MEDIUM", "LOW"]);
const rating = z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]);

export default defineTool({
	description:
		"Record cited, evidence-backed Atlas commercial enrichment for the dispatched lead and reevaluate its quality gate. This never sends or queues outreach.",
	inputSchema: z.object({
		leadId: z.string().min(1),
		evidence: z.array(
			z.object({
				field: z.string().min(1).max(80),
				summary: z.string().min(1).max(1000),
				sourceUrl: z.url().max(2048),
				confidence,
			}),
		),
		currentClub: z
			.object({
				value: z.string().min(1).max(300),
				sourceUrl: z.url().max(2048),
				confidence,
			})
			.optional(),
		whyNow: z
			.object({
				supported: z.boolean(),
				summary: z.string().min(1).max(1000),
				sourceUrl: z.url().max(2048).optional(),
				confidence,
			})
			.optional(),
		language: z
			.object({
				profileLanguage: z.string().max(80).optional(),
				languageSignals: z.array(z.string().max(200)).optional(),
				organizationDomain: z.string().max(300).optional(),
				organizationName: z.string().max(300).optional(),
			})
			.optional(),
		ratings: z
			.object({
				careerStage: rating.optional(),
				momentum: rating.optional(),
				mediaGap: rating.optional(),
				iblFit: rating.optional(),
				mediaSophistication: rating.optional(),
				agencyLeverage: rating.optional(),
				decisionMakerQuality: rating.optional(),
				accessibility: rating.optional(),
				evidenceFreshness: rating.optional(),
				opportunityDistinctness: rating.optional(),
				hookStrength: rating.optional(),
				scarceSlotWorthiness: rating.optional(),
			})
			.optional(),
	}),
	async execute(input, ctx) {
		return recordAtlasCommercialEnrichment(
			ctx,
			input as AtlasCommercialEnrichmentInput,
		);
	},
});
