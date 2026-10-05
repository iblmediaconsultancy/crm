import { describe, expect, test } from "bun:test";
import {
	mapWithConcurrency,
	selectPreparedFollowUpMembers,
} from "../src/providers/follow-up-cohort-batch";

describe("follow-up cohort batch evaluation", () => {
	test("processes a production-sized preview with bounded concurrency and stable order", async () => {
		const ids = Array.from({ length: 268 }, (_value, index) => `step-${index}`);
		let active = 0;
		let peak = 0;
		const results = await mapWithConcurrency(ids, 8, async (id, index) => {
			active += 1;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, index % 3));
			active -= 1;
			return {
				id,
				eligible: index < 124,
				reason: index < 124 ? null : "FOLLOW_UP_ORGANIZATION_UNRESOLVED",
			};
		});
		expect(peak).toBeLessThanOrEqual(8);
		expect(results).toHaveLength(268);
		expect(results.map((result) => result.id)).toEqual(ids);
		expect(results.filter((result) => result.eligible)).toHaveLength(124);
		expect(
			results.filter(
				(result) => result.reason === "FOLLOW_UP_ORGANIZATION_UNRESOLVED",
			),
		).toHaveLength(144);
	});

	test("returns an empty result without starting workers", async () => {
		let called = false;
		await expect(
			mapWithConcurrency([], 8, async () => {
				called = true;
				return null;
			}),
		).resolves.toEqual([]);
		expect(called).toBe(false);
	});

	test("rejects an invalid concurrency limit", async () => {
		await expect(
			mapWithConcurrency(["step-1"], 0, async (value) => value),
		).rejects.toThrow("Concurrency must be a positive integer.");
	});

	test("persists only still-due eligible IDs and records drift exclusions", () => {
		const now = new Date("2026-10-05T07:00:00.000Z");
		const ids = Array.from({ length: 268 }, (_value, index) => `step-${index}`);
		const evaluated = ids.map((id, index) => ({
			id,
			evaluation: {
				eligible: index < 124,
				reason: index < 124 ? null : "FOLLOW_UP_ORGANIZATION_UNRESOLVED",
				canonicalDueAt:
					index < 124 ? new Date("2026-10-05T06:00:00.000Z") : null,
			},
		}));
		const currentSteps = ids.slice(0, 124).map((id, index) => ({
			id,
			status: index === 2 ? "LEASED" : "PENDING",
			dueAt: new Date(
				index === 3 ? "2026-10-05T08:00:00.000Z" : "2026-10-05T06:00:00.000Z",
			),
			retryAt: null,
			leasedUntil: null,
			attemptCount: 0,
			maxAttempts: 5,
			plan: { status: "ACTIVE", channel: "EMAIL" },
		}));
		const { members, excluded } = selectPreparedFollowUpMembers(
			evaluated,
			currentSteps,
			new Set(["step-1"]),
			now,
		);
		expect(members).toHaveLength(121);
		expect(members.map((member) => member.followUpStepId)).not.toContain(
			"step-1",
		);
		expect(members.map((member) => member.followUpStepId)).not.toContain(
			"step-2",
		);
		expect(members.map((member) => member.followUpStepId)).not.toContain(
			"step-3",
		);
		expect(excluded).toHaveLength(147);
		expect(
			excluded.filter(
				(row) => row.reason === "FOLLOW_UP_ORGANIZATION_UNRESOLVED",
			),
		).toHaveLength(144);
		expect(excluded).toContainEqual({
			followUpStepId: "step-1",
			reason: "EXISTING_EXECUTABLE_COHORT",
		});
		expect(excluded).toContainEqual({
			followUpStepId: "step-2",
			reason: "FOLLOW_UP_STATE_CHANGED_DURING_PREPARATION",
		});
		expect(excluded).toContainEqual({
			followUpStepId: "step-3",
			reason: "FOLLOW_UP_STATE_CHANGED_DURING_PREPARATION",
		});
	});
});
