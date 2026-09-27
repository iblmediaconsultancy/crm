import { defineTool } from "eve/tools";
import { z } from "zod";
import { listAtlasOutreachQueue } from "../lib/atlas-outreach";

export default defineTool({
	description:
		"List the small set of CRM leads currently eligible for one safe Atlas email. This is read-only and does not send anything.",
	inputSchema: z.object({}),
	execute(_input, ctx) {
		return listAtlasOutreachQueue(ctx);
	},
});
