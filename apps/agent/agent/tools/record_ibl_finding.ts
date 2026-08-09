import type { Prisma } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { recordFinding } from "../lib/ibl-research";

export default defineTool({
	description:
		"Propose one finding for the current IBL research request, tied to a recorded evidence source. Findings remain subject to human review.",
	inputSchema: z.object({
		evidenceSourceId: z.string().min(1),
		field: z.string().min(1).max(120).optional(),
		summary: z.string().min(1).max(1000),
		value: z.json().optional(),
		confidence: z.number().min(0).max(1),
	}),
	execute(input, ctx) {
		return recordFinding(ctx, {
			...input,
			value: input.value as Prisma.InputJsonValue | undefined,
		});
	},
});
