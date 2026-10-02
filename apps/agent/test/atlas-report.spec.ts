import { describe, expect, it } from "bun:test";
import {
	atlasLocalDateKey,
	atlasReportWindow,
} from "../agent/lib/atlas-report";

describe("Atlas daily report timing", () => {
	it("uses Amsterdam local dates", () => {
		expect(atlasLocalDateKey(new Date("2026-09-21T22:30:00.000Z"))).toBe(
			"2026-09-22",
		);
	});

	it("fires on a weekday at the configured local minute", () => {
		expect(atlasReportWindow(new Date("2026-09-21T17:00:00.000Z"))).toBe(true);
		expect(atlasReportWindow(new Date("2026-09-20T17:00:00.000Z"))).toBe(false);
	});
});
