import { defineTool } from "eve/tools";
import { z } from "zod";
import { submitResearchForReview } from "../lib/ibl-research";

export default defineTool({
	description:
		"Finish the current IBL research run by submitting its evidence-backed findings for human review. This does not accept findings or approve drafts.",
	inputSchema: z.object({
		summary: z.string().min(1).max(500),
	}),
	execute(input, ctx) {
		return submitResearchForReview(ctx, input);
	},
});
