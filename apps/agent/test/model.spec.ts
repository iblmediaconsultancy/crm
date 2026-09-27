import { describe, expect, it } from "bun:test";
import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";
import rootAgent from "../agent/agent";
import { AGENT_MODEL } from "../agent/lib/model";
import builderAgent from "../agent/subagents/agent_builder/agent";
import runnerAgent from "../agent/subagents/agent_runner/agent";

describe("the configured agent model", () => {
	it("uses the direct Gemini provider and fixed context window", () => {
		expect(DEFAULT_AGENT_MODEL).toEqual({
			id: "gemini-3.1-flash-lite",
			contextWindowTokens: 1_048_576,
		});
		expect(AGENT_MODEL.modelId).toBe(DEFAULT_AGENT_MODEL.id);
		for (const agent of [rootAgent, builderAgent, runnerAgent]) {
			expect(agent.model).toBe(AGENT_MODEL);
			expect(agent.modelContextWindowTokens).toBe(1_048_576);
		}
	});
});
