import { describe, expect, test } from "bun:test";
import { businessV1Rows } from "../fixtures/business-v1";
import { orderMigrationOutcomes } from "../src/apply-order";
import { planRows } from "../src/core";

describe("V1 persistence apply contract", () => {
	test("orders every mapped target after its required parent types", () => {
		const outcomes = orderMigrationOutcomes(planRows(businessV1Rows, { ownerUserId: "fixture-owner" }));
		const position = new Map(outcomes.map((outcome, index) => [outcome.targetTable, index]));

		expect(position.get("user")).toBeLessThan(position.get("lead") as number);
		expect(position.get("company")).toBeLessThan(position.get("agency") as number);
		expect(position.get("contactRoute")).toBeLessThan(position.get("sharedRoutePolicy") as number);
		expect(position.get("emailThread")).toBeLessThan(position.get("emailMessage") as number);
		expect(position.get("researchRequest")).toBeLessThan(position.get("researchFinding") as number);
		expect(position.get("duplicateCandidate")).toBeLessThan(position.get("mergeDecision") as number);
	});

	test("every mapped fixture carries a JSON-safe source ledger payload", () => {
		const outcomes = planRows(businessV1Rows, { ownerUserId: "fixture-owner" });

		for (const outcome of outcomes) {
			expect(() => JSON.stringify({
				sourceSnapshot: outcome.payload?.sourceSnapshot,
				payload: outcome.payload,
				fieldCoverage: outcome.fieldCoverage,
			})).not.toThrow();
		}
	});
});
