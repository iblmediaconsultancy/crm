import { defineTool } from "eve/tools";
import { z } from "zod";
import { writeAtlasDailyReport } from "../lib/atlas-report";

export default defineTool({
	description:
		"Persist the weekday Atlas daily operating report as a separate CRM report snapshot. This does not send email or change outreach state.",
	inputSchema: z.object({}),
	execute(_input, ctx) {
		return writeAtlasDailyReport(ctx);
	},
});
