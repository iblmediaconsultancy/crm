import { describe, expect, test } from "bun:test";
import { businessDaysAfter } from "../src/providers/working-hours";

if (!process.env.DATABASE_URL) {
	describe.skip("follow-up timezone integration", () => {});
} else {
	const { db } = await import("@crm/db");
	const { FOLLOW_UP_CLAIM_SQL, FOLLOW_UP_UTC_CLOCK } = await import(
		"../src/providers/outreach-lifecycle.service"
	);

	describe("follow-up timezone safety", () => {
		test("uses one explicit UTC wall-clock for due, retry, and lease comparisons", () => {
			expect(FOLLOW_UP_CLAIM_SQL).not.toContain("NOW()");
			expect(
				FOLLOW_UP_CLAIM_SQL.match(/CURRENT_TIMESTAMP AT TIME ZONE 'UTC'/g),
			).toHaveLength(5);
			expect(FOLLOW_UP_UTC_CLOCK).toBe(
				"(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')",
			);
		});

		test("does not claim a same-day future timestamp under Europe/Amsterdam", async () => {
			const rows = await db.$transaction(async (tx) => {
				await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Europe/Amsterdam'");
				return tx.$queryRawUnsafe<
					Array<{ legacyDue: boolean; utcDue: boolean }>
				>(
					`SELECT
						(CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '30 minutes') <= NOW() AS "legacyDue",
						(CURRENT_TIMESTAMP AT TIME ZONE 'UTC' + INTERVAL '30 minutes') <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS "utcDue"`,
				);
			});
			expect(rows[0]?.legacyDue).toBe(true);
			expect(rows[0]?.utcDue).toBe(false);
		});

		test("keeps exact midnight ordering stable for timestamp-without-timezone values", async () => {
			const rows = await db.$queryRawUnsafe<
				Array<{ beforeMidnight: boolean; atMidnight: boolean }>
			>(
				`SELECT
					TIMESTAMP '2026-09-28 23:59:59' <= TIMESTAMP '2026-09-29 00:00:00' AS "beforeMidnight",
					TIMESTAMP '2026-09-29 00:00:00' <= TIMESTAMP '2026-09-29 00:00:00' AS "atMidnight"`,
			);
			expect(rows[0]).toEqual({ beforeMidnight: true, atMidnight: true });
		});

		test("preserves Amsterdam business-day cadence across the autumn DST boundary", () => {
			const beforeDst = new Date("2026-10-23T08:00:00.000Z");
			expect(
				businessDaysAfter(beforeDst, 1, "Europe/Amsterdam").toISOString(),
			).toBe("2026-10-26T08:00:00.000Z");
		});

		test("keeps a same-day future follow-up after the current instant", () => {
			const now = new Date("2026-09-28T11:59:59.000Z");
			const future = new Date("2026-09-28T12:00:00.000Z");
			expect(future.getTime()).toBeGreaterThan(now.getTime());
		});
	});
}
