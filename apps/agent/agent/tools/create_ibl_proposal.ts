import type { Prisma } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { createResearchProposal } from "../lib/ibl-research";

export default defineTool({
	description:
		"Create a draft IBL proposal for human review, optionally linked to an unsent owned draft.",
	inputSchema: z
		.object({
			title: z.string().min(1).max(300),
			summary: z.string().min(1).max(1000).optional(),
			content: z.json(),
			leadId: z.string().min(1).optional(),
			dealId: z.string().min(1).optional(),
			draftId: z.string().min(1).optional(),
			idempotencyKey: z.string().min(1).max(100),
		})
		.refine((input) => Boolean(input.leadId) !== Boolean(input.dealId), {
			message: "Provide exactly one leadId or dealId.",
		}),
	execute(input, ctx) {
		return createResearchProposal(ctx, {
			...input,
			content: input.content as Prisma.InputJsonValue,
		});
	},
});
