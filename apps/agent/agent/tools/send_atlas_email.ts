import { defineTool } from "eve/tools";
import { z } from "zod";
import { sendAtlasEmail } from "../lib/atlas-outreach";

export default defineTool({
	description:
		"Queue one Atlas email through the CRM safety gates. It does not expose provider credentials and it cannot send through social channels or bypass suppression, cooldown, quota, working-hours, language, or handoff rules.",
	inputSchema: z.object({
		leadId: z.string().min(1),
		routeId: z.string().min(1),
		subject: z.string().min(1).max(300),
		body: z.string().min(1).max(50_000),
		language: z.enum(["English", "Dutch", "Turkish"]),
		idempotencyKey: z.string().min(1).max(191),
		commercial: z
			.object({
				organization: z.string().optional(),
				playerOrOpportunity: z.string().optional(),
				campaignPurpose: z.string().optional(),
				requestedLanguage: z.string().optional(),
				currentClub: z.string().nullable().optional(),
				currentClubVerified: z.boolean().optional(),
				currentClubRequired: z.boolean().optional(),
				copyReferencesCurrentClub: z.boolean().optional(),
				whyNowRequiresClub: z.boolean().optional(),
				associationRequiresClub: z.boolean().optional(),
				identityResolved: z.boolean().optional(),
				organizationResolved: z.boolean().optional(),
				playerOrganizationAssociationResolved: z.boolean().optional(),
				whyNowSupported: z.boolean().optional(),
				whyNowRequired: z.boolean().optional(),
				fabricatedOrContradictedHook: z.boolean().optional(),
				placeholderHook: z.boolean().optional(),
				subjectBodyAligned: z.boolean().optional(),
				routeOpportunityConflict: z.boolean().optional(),
				opportunityAlreadyActive: z.boolean().optional(),
				language: z
					.object({
						profileLanguage: z.string().nullable().optional(),
						profileLanguages: z.array(z.string()).optional(),
						languageSignals: z.array(z.string()).optional(),
						organizationDomain: z.string().nullable().optional(),
						organizationName: z.string().nullable().optional(),
						contactName: z.string().nullable().optional(),
					})
					.optional(),
				careerStage: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).optional(),
				momentum: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).optional(),
				mediaGap: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).optional(),
				iblFit: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).optional(),
				mediaSophistication: z
					.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"])
					.optional(),
				agencyLeverage: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).optional(),
				decisionMakerQuality: z
					.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"])
					.optional(),
				accessibility: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).optional(),
				evidenceFreshness: z
					.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"])
					.optional(),
				opportunityDistinctness: z
					.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"])
					.optional(),
				hookStrength: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).optional(),
				scarceSlotWorthiness: z
					.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"])
					.optional(),
			})
			.optional(),
	}),
	execute(input, ctx) {
		return sendAtlasEmail(ctx, input);
	},
});
