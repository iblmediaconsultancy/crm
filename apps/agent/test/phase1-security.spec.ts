import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const manifest = JSON.parse(
	readFileSync(join(root, "agent", "capabilities.json"), "utf8"),
) as {
	defaultPolicy: string;
	networkPolicy: string;
	forbiddenCapabilities: string[];
};

describe("Phase 1 agent permissions", () => {
	test("capabilities remain default deny with no outbound transport", () => {
		expect(manifest.defaultPolicy).toBe("deny");
		expect(manifest.networkPolicy).toBe("deny-all");
		expect(manifest.forbiddenCapabilities).toContain("email.send");
		expect(manifest.forbiddenCapabilities).toContain("resend.send");
		expect(manifest.forbiddenCapabilities).toContain("shell.generic");
	});

	test("generic shell and root delegation tools are disabled", () => {
		for (const path of [
			"agent/tools/agent.ts",
			"agent/subagents/agent_builder/tools/bash.ts",
			"agent/subagents/agent_runner/tools/bash.ts",
		]) {
			expect(readFileSync(join(root, path), "utf8")).toContain("disableTool");
		}
	});
});
