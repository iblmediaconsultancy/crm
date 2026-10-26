import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const client = new pg.Client({ connectionString });

beforeAll(async () => {
	await client.connect();
});

afterAll(async () => {
	await client.end();
});

describe("Atlas authorization expiry clock", () => {
	test("uses UTC wall-clock values independent of the database session timezone", async () => {
		const definition = await client.query<{ definition: string }>(
			"SELECT pg_get_functiondef('ibl_guard_draft_outreach()'::regprocedure) AS definition",
		);
		expect(definition.rows[0]?.definition).toContain(
			"CURRENT_TIMESTAMP AT TIME ZONE 'UTC'",
		);

		const instants = [
			{
				zone: "UTC",
				before: "2026-03-29T00:59:59.999Z",
				boundary: "2026-03-29T01:00:00.000Z",
				after: "2026-03-29T01:00:00.001Z",
			},
			{
				zone: "Europe/Amsterdam",
				before: "2026-03-29T00:59:59.999Z",
				boundary: "2026-03-29T01:00:00.000Z",
				after: "2026-03-29T01:00:00.001Z",
			},
			{
				zone: "Europe/Berlin",
				before: "2026-03-29T00:59:59.999Z",
				boundary: "2026-03-29T01:00:00.000Z",
				after: "2026-03-29T01:00:00.001Z",
			},
			{
				zone: "Europe/Amsterdam",
				before: "2026-10-25T00:59:59.999Z",
				boundary: "2026-10-25T01:00:00.000Z",
				after: "2026-10-25T01:00:00.001Z",
			},
			{
				zone: "Europe/Berlin",
				before: "2026-10-25T00:59:59.999Z",
				boundary: "2026-10-25T01:00:00.000Z",
				after: "2026-10-25T01:00:00.001Z",
			},
		];

		for (const instant of instants) {
			await client.query("SELECT set_config('TimeZone',$1,false)", [
				instant.zone,
			]);
			const result = await client.query<{ before: boolean; after: boolean }>(
				"SELECT ($1::timestamptz AT TIME ZONE 'UTC') < ($2::timestamptz AT TIME ZONE 'UTC') AS before, ($3::timestamptz AT TIME ZONE 'UTC') < ($2::timestamptz AT TIME ZONE 'UTC') AS after",
				[instant.before, instant.boundary, instant.after],
			);
			expect(result.rows[0]).toEqual({ before: true, after: false });
		}
	});
});
