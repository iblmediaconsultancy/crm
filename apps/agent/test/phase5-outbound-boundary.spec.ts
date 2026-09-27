import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "agent");

function sourceFiles(path: string): string[] {
	return readdirSync(path).flatMap((name) => {
		const child = join(path, name);
		return statSync(child).isDirectory()
			? sourceFiles(child)
			: child.endsWith(".ts")
				? [child]
				: [];
	});
}

describe("Phase 5 outbound boundary", () => {
	test("agent source cannot import provider or outbound transport modules", () => {
		const forbiddenImport =
			/from\s+["'][^"']*(?:providers|outbound-delivery|resend|smtp)[^"']*["']/i;
		for (const file of sourceFiles(root)) {
			expect(readFileSync(file, "utf8"), file).not.toMatch(forbiddenImport);
		}
	});

	test("only bounded IBL tools exist and generic delegation stays disabled", () => {
		const manifest = JSON.parse(
			readFileSync(join(root, "capabilities.json"), "utf8"),
		) as { defaultPolicy: string; allowedCapabilityClasses: string[] };
		expect(manifest.defaultPolicy).toBe("deny");
		expect(manifest.allowedCapabilityClasses).toEqual([
			"research",
			"read",
			"proposal",
		]);
		expect(readFileSync(join(root, "tools", "agent.ts"), "utf8")).toContain(
			"disableTool",
		);
	});
});
