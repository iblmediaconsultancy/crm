import { defineTool } from "eve/tools";
import { z } from "zod";
import { createResearchDraft } from "../lib/ibl-research";

export default defineTool({
	description:
		"Create an unsent IBL draft for human review. This tool cannot approve, queue, or send it.",
	inputSchema: z.object({
		subject: z.string().min(1).max(300).optional(),
		body: z.string().min(1).max(50_000),
		idempotencyKey: z.string().min(1).max(100),
	}),
	execute(input, ctx) {
		return createResearchDraft(ctx, input);
	},
});
