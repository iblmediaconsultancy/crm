import { describe, expect, test } from "bun:test";
import {
	canonicalJson,
	planRows,
	sourceIdentity,
	summarize,
} from "../src/core";

describe("V1 migration planner", () => {
	test("stable keys do not depend on object key order", () => {
		expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
		expect(sourceIdentity("legacy", { a: 1, b: 2 })).toEqual(
			sourceIdentity("legacy", { b: 2, a: 1 }),
		);
	});

	test("maps supported rows and explicitly rejects every unsupported row", () => {
		const outcomes = planRows(
			[
				{
					table: "leads",
					row: { id: "1", name: "Example Lead", status: "qualified" },
				},
				{ table: "templates", row: { id: "2", name: "Intro", body: "Hello" } },
				{
					table: "mailbox_credentials",
					row: { id: "3", encrypted_secret: "never copied" },
				},
			],
			{ ownerUserId: "user_1" },
		);
		expect(summarize(outcomes)).toEqual({
			total: 3,
			accounted: 3,
			byOutcome: { MAPPED: 2, REJECTED: 1, DUPLICATE_CANDIDATE: 0 },
			byReason: { UNSUPPORTED_SOURCE_TABLE: 1 },
		});
		expect(JSON.stringify(outcomes)).not.toContain("never copied");
	});

	test("surfaces normalized duplicates without merging", () => {
		const outcomes = planRows(
			[
				{
					table: "football_entities",
					row: { id: "1", entity_kind: "player", display_name: "Ada  Striker" },
				},
				{
					table: "football_entities",
					row: { id: "2", entity_kind: "player", display_name: "ada-striker" },
				},
			],
			{ ownerUserId: "user_1" },
		);
		expect(outcomes.map((item) => item.outcome)).toEqual([
			"MAPPED",
			"DUPLICATE_CANDIDATE",
		]);
	});

	test("fails closed without an explicit V2 owner", () => {
		const [outcome] = planRows(
			[{ table: "leads", row: { id: "1", name: "Lead" } }],
			{ ownerUserId: "" },
		);
		expect(outcome?.reasonCode).toBe("MISSING_V2_OWNER");
	});
});
