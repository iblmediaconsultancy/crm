import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";
import { type AgentDefinition, defineAgent } from "eve";
import { z } from "zod";
import { AGENT_MODEL } from "../../lib/model";

export default defineAgent({
	description:
		"Execute one immutable deployed CRM agent version and persist its result and every side effect.",
	model: AGENT_MODEL,
	modelContextWindowTokens: DEFAULT_AGENT_MODEL.contextWindowTokens,
	outputSchema: z.object({
		summary: z.string().min(1).max(1000),
		result: z.record(z.string(), z.unknown()).nullable(),
	}),
	limits: {
		maxInputTokensPerSession: 500_000,
		maxOutputTokensPerSession: 40_000,
		sessionTimeoutMs: 24 * 60 * 60 * 1000,
	},
}) as AgentDefinition;
