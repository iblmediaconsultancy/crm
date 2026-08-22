import { describe, expect, test } from "bun:test";
import {
	buildDelta,
	deltaBoundary,
	fingerprintAppliedResult,
	fingerprintPlan,
	fingerprintSnapshot,
	replayDelta,
	reconciliationPassed,
	snapshotBoundary,
} from "../src/operational-safety";
import type { ExportRow } from "../src/core";

const watermark = (transaction_id: string, snapshot_id: string) => ({
	transaction_id,
	captured_at: `2026-08-22T12:00:${transaction_id}.000Z`,
	snapshot_id,
});

const base: ExportRow[] = [
	{ table: "leads", row: { id: "lead-1", name: "Original" } },
	{ table: "contacts", row: { id: "contact-1", name: "Keep" } },
];

describe("operational migration safety", () => {
	test("creates an explicit repeatable-read snapshot boundary", () => {
		const boundary = snapshotBoundary("100", "2026-08-22T12:00:00.000Z", "100:1");
		expect(boundary.mode).toBe("SNAPSHOT");
		expect(boundary.toWatermark.snapshot_id).toBe("100:1");
	});

	test("exports deterministic upserts and deletes with an advancing delta watermark", () => {
		const next = [
			{ table: "leads", row: { id: "lead-1", name: "Updated" } },
			{ table: "leads", row: { id: "lead-2", name: "Added" } },
		];
		const delta = buildDelta(
			base,
			next,
			deltaBoundary(watermark("100", "100:1"), watermark("110", "110:1"), "base-checksum"),
		);
		expect(delta.rows).toEqual([
			{ table: "leads", operation: "UPSERT", row: { id: "lead-1", name: "Updated" }, sourceId: "lead-1" },
			{ table: "leads", operation: "UPSERT", row: { id: "lead-2", name: "Added" }, sourceId: "lead-2" },
			{ table: "contacts", operation: "DELETE", row: {}, sourceId: "contact-1" },
		]);
		expect(delta.checksum).toHaveLength(64);
	});

	test("replays multiple deltas idempotently and detects tampering", () => {
		const first = buildDelta(
			base,
			[{ table: "leads", row: { id: "lead-1", name: "Updated" } }],
			deltaBoundary(watermark("100", "100:1"), watermark("110", "110:1"), "base-checksum"),
		);
		const afterFirst = replayDelta(base, first);
		const second = buildDelta(
			afterFirst,
			[{ table: "leads", row: { id: "lead-1", name: "Updated" } }, { table: "leads", row: { id: "lead-2", name: "Added" } }],
			deltaBoundary(watermark("110", "110:1"), watermark("120", "120:1"), "first-checksum"),
		);
		const expected = replayDelta(afterFirst, second);
		expect(replayDelta(afterFirst, second)).toEqual(replayDelta(afterFirst, second));
		expect(replayDelta(expected, { ...second, checksum: second.checksum })).toEqual(expected);
		expect(() => replayDelta(afterFirst, { ...second, checksum: "bad" })).toThrow("checksum");
	});

	test("fingerprints snapshots, plans, and applied results deterministically", () => {
		const boundary = snapshotBoundary("100", "2026-08-22T12:00:00.000Z", "100:1");
		expect(fingerprintSnapshot([...base].reverse(), boundary)).toBe(fingerprintSnapshot(base, boundary));
		expect(fingerprintPlan({ b: 2, a: 1 })).toBe(fingerprintPlan({ a: 1, b: 2 }));
		expect(fingerprintAppliedResult({ runId: "run-1", rows: 2 })).toHaveLength(64);
	});

	test("fails reconciliation when any safety invariant is false", () => {
		const checks = {
			manifestChecksumMatches: true,
			classificationComplete: true,
			zeroUnexplainedLoss: true,
			targetReconciled: true,
		};
		expect(reconciliationPassed(checks)).toBe(true);
		expect(reconciliationPassed({ ...checks, targetReconciled: false })).toBe(false);
	});
});
