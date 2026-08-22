import { describe, expect, test } from "bun:test";
import { businessV1Rows } from "../fixtures/business-v1";
import {
	planRows,
	summarize,
	targetIdForTest,
} from "../src/core";

describe("V1 business mapping coverage", () => {
	test("maps every populated business fixture category with complete field coverage", () => {
		const outcomes = planRows(businessV1Rows, { ownerUserId: "v2-owner" });
		const summary = summarize(outcomes);

		expect(outcomes).toHaveLength(businessV1Rows.length);
		expect(outcomes.every((outcome) => outcome.outcome === "MAPPED")).toBe(true);
		expect(outcomes.every((outcome) => outcome.fieldCoverage?.unsupported && Object.keys(outcome.fieldCoverage.unsupported).length === 0)).toBe(true);
		expect(summary.complete).toBe(true);
		expect(summary.fieldCoverageComplete).toBe(true);
		expect([...new Set(outcomes.map((outcome) => outcome.targetTable))]).toEqual(
			expect.arrayContaining(["footballPlayer", "footballAgent", "agency", "club"]),
		);
		expect(new Set(outcomes.map((outcome) => outcome.sourceTable))).toEqual(
		new Set(businessV1Rows.map((row) => row.table)),
		);
	});

	test("preserves ownership, source identity, relationships, and full source snapshots", () => {
		const outcomes = planRows(businessV1Rows, { ownerUserId: "v2-owner" });
		const lead = outcomes.find((outcome) => outcome.sourceTable === "leads");
		const relationship = outcomes.find((outcome) => outcome.sourceTable === "football_relationships");
		const message = outcomes.find((outcome) => outcome.sourceTable === "email_messages");

		expect(lead?.payload?.ownerUserId).toBe(targetIdForTest("profiles", "profile-1"));
		expect(lead?.payload?.sourceKey).toContain("ibl-v1:leads:");
		expect(relationship?.payload?.sourceSnapshot).toMatchObject({
			from_entity_id: "entity-agent-1",
			to_entity_id: "entity-player-1",
		});
		expect(message?.payload?.sourceSnapshot).toMatchObject({
			message_id: "<fixture-message-1@example.test>",
			text_body: "Sanitized email body",
		});
	});

	test("surfaces collisions and unmapped categories instead of silently dropping them", () => {
		const [first, second, unsupported] = planRows(
			[
				{ table: "leads", row: { id: "lead-a", name: "Same Lead", organization: "Same Org" } },
				{ table: "leads", row: { id: "lead-b", name: "same-lead", organization: "same org" } },
				{ table: "saved_searches", row: { id: "search-1", name: "Fixture search" } },
			],
			{ ownerUserId: "v2-owner" },
		);

		expect(first?.outcome).toBe("MAPPED");
		expect(second?.outcome).toBe("DUPLICATE_CANDIDATE");
		expect(second?.reasonCode).toBe("NORMALIZED_IDENTITY_COLLISION");
		expect(unsupported?.outcome).toBe("REJECTED");
		expect(unsupported?.reasonCode).toBe("UNSUPPORTED_SOURCE_TABLE");
	});
});
