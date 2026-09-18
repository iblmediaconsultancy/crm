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
	}),
	execute(input, ctx) {
		return sendAtlasEmail(ctx, input);
	},
});
