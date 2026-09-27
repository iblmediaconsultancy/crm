import { defineTool } from "eve/tools";
import { z } from "zod";
import { recordEvidence } from "../lib/ibl-research";

export default defineTool({
	description:
		"Record a source for the current IBL research request. The observed content is hashed for provenance and is never stored in the evidence row.",
	inputSchema: z.object({
		kind: z.enum([
			"PUBLIC_URL",
			"DOCUMENT",
			"MAILBOX_MESSAGE",
			"MANUAL",
			"IMPORT",
		]),
		locator: z.string().min(1).max(2048),
		title: z.string().min(1).max(300).optional(),
		observedContent: z.string().min(1).max(100_000),
		capturedAt: z.iso.datetime().optional(),
	}),
	execute(input, ctx) {
		return recordEvidence(ctx, {
			...input,
			capturedAt: input.capturedAt ? new Date(input.capturedAt) : undefined,
		});
	},
});
