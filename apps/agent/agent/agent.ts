import "@crm/env/load";

import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";
import { type AgentDefinition, defineAgent } from "eve";
import { logCapabilities } from "./lib/capabilities";
import { AGENT_MODEL } from "./lib/model";

if (process.env.AGENT_BUILD !== "true") void logCapabilities();

export default defineAgent({
	model: AGENT_MODEL,
	modelContextWindowTokens: DEFAULT_AGENT_MODEL.contextWindowTokens,
	limits: {
		maxInputTokensPerSession: 500_000,
		maxOutputTokensPerSession: 50_000,
		sessionTimeoutMs: 30 * 24 * 60 * 60 * 1000,
	},
}) as AgentDefinition;
