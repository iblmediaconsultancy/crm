import { defineTool } from "eve/tools";
import { z } from "zod";
import { inspectResearchRequest } from "../lib/ibl-research";

export default defineTool({
	description:
		"Read the authenticated IBL identity envelope, the exact scoped research request, and its existing evidence-backed findings.",
	inputSchema: z.object({}),
	execute(_input, ctx) {
		return inspectResearchRequest(ctx);
	},
});
