import { defineTool } from "eve/tools";
import { z } from "zod";
import {
	AGENT_CAPABILITIES,
	requireIblAgentIdentity,
} from "../lib/ibl-agent-policy";

export default defineTool({
	description:
		"Optionally inspect the bounded IBL agent capability set. Anything not listed is denied, and provider configuration is not disclosed.",
	inputSchema: z.object({}),
	async execute(_input, ctx) {
		await requireIblAgentIdentity(ctx, "read.identity");
		return {
			defaultPolicy: "deny" as const,
			networkPolicy: "deny-all" as const,
			allowed: AGENT_CAPABILITIES,
			outboundTransport: false as const,
		};
	},
});
