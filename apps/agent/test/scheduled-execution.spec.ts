import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { resolveEveExecutable } from "../agent/lib/eve-launcher";
import {
	isScheduledExecutionEnabled,
	SCHEDULED_EXECUTION_ENV,
} from "../agent/lib/scheduled-execution";

describe("scheduled agent execution gate", () => {
	it("defaults to disabled and only accepts an explicit true value", () => {
		expect(isScheduledExecutionEnabled({})).toBe(false);
		expect(
			isScheduledExecutionEnabled({ [SCHEDULED_EXECUTION_ENV]: "TRUE" }),
		).toBe(true);
		expect(
			isScheduledExecutionEnabled({ [SCHEDULED_EXECUTION_ENV]: "1" }),
		).toBe(false);
	});

	it("prefers the Windows executable and supports command shims", () => {
		expect(
			resolveEveExecutable("win32", ["C:/agent/node_modules/.bin"], (path) =>
				path.endsWith("eve.exe"),
			),
		).toBe(join("C:/agent/node_modules/.bin", "eve.exe"));
		expect(
			resolveEveExecutable("win32", ["C:/agent/node_modules/.bin"], (path) =>
				path.endsWith("eve.cmd"),
			),
		).toBe(join("C:/agent/node_modules/.bin", "eve.cmd"));
	});
});
