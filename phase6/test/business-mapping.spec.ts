import { describe, expect, test } from "bun:test";
import { businessV1Rows } from "../fixtures/business-v1";
import {
	mappingTargetForTest,
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

	test("preserves outreach state and events while blocking unreviewed template history", () => {
		const outcomes = planRows([
			{ table: "lead_outreach_state", row: { id: "outreach-state-1", lead_id: "lead-1", state: "ACTIVE", created_at: "2026-08-21T12:00:00.000Z" } },
			{ table: "outreach_events", row: { id: "outreach-event-1", event_key: "event-1", lead_id: "lead-1", event_type: "SENT", created_at: "2026-08-21T12:00:00.000Z" } },
			{ table: "template_revisions", row: { id: "revision-1", template_id: "template-1", revision_number: 1, snapshot: { body: "Fixture body" } } },
			{ table: "template_usages", row: { id: "usage-1", template_id: "template-1", usage_type: "RENDERED" } },
		], { ownerUserId: "v2-owner" });

		expect(outcomes[0]?.outcome).toBe("MAPPED");
		expect(outcomes[0]?.targetTable).toBe("lifecycleEvent");
		expect(outcomes[1]?.outcome).toBe("MAPPED");
		expect(outcomes[1]?.targetTable).toBe("lifecycleEvent");
		expect(outcomes[2]?.outcome).toBe("REJECTED");
		expect(outcomes[2]?.reasonCode).toBe("UNSUPPORTED_SOURCE_TABLE");
		expect(outcomes[3]?.outcome).toBe("REJECTED");
		expect(outcomes[3]?.reasonCode).toBe("UNSUPPORTED_SOURCE_TABLE");
	});

	test("does not classify shared routes owned by distinct entities as duplicates", () => {
		const outcomes = planRows([
			{ table: "football_contact_routes", row: { id: "route-a", route_type: "EMAIL", route_value: "shared@example.test" } },
			{ table: "football_contact_routes", row: { id: "route-b", route_type: "EMAIL", route_value: "shared@example.test" } },
			{ table: "football_entity_contact_routes", row: { id: "link-a", contact_route_id: "route-a", entity_id: "entity-a" } },
			{ table: "football_entity_contact_routes", row: { id: "link-b", contact_route_id: "route-b", entity_id: "entity-b" } },
		], { ownerUserId: "v2-owner" });

		expect(outcomes.filter((outcome) => outcome.sourceTable === "football_contact_routes").every((outcome) => outcome.outcome === "MAPPED")).toBe(true);
	});

	test("maps known V1 statuses and directions to valid V2 enums", () => {
		const outcomes = planRows([
			{ table: "leads", row: { id: "lead-status-1", name: "Status Lead", status: "Waiting reply" } },
			{ table: "leads", row: { id: "lead-status-2", name: "Status Lead 2", status: "Contact invalid" } },
			{ table: "saved_email_drafts", row: { id: "draft-status-1", status: "SENT", body: "Sanitized draft" } },
		], { ownerUserId: "v2-owner" });

		expect(outcomes[0]?.payload?.status).toBe("NURTURING");
		expect(outcomes[1]?.payload?.status).toBe("DISQUALIFIED");
		expect(outcomes[2]?.payload?.status).toBe("DRAFT");
	});

	test("resolves player club names through exported club entities", () => {
		const outcomes = planRows([
			{ table: "football_entities", row: { id: "club-1", entity_kind: "organization", display_name: "Example Club" } },
			{ table: "football_organization_details", row: { entity_id: "club-1", organization_type: "Club" } },
			{ table: "football_player_details", row: { entity_id: "player-1", club: "Example Club" } },
		], { ownerUserId: "v2-owner" });

		expect(outcomes[2]?.payload?.currentClubId).toBe(targetIdForTest("football_entities", "club-1"));
	});

	test("keeps football relationship history out of representation without player-agent evidence", () => {
		expect(mappingTargetForTest("football_relationships", { relationship_type: "Player→Club" })).toBe("lifecycleEvent");
		expect(mappingTargetForTest("football_relationships", { relationship_type: "Person→Agency" })).toBe("lifecycleEvent");
	});

	test("assigns deterministic positions when proposal items share a source position", () => {
		const outcomes = planRows([
			{ table: "ai_proposal_items", row: { id: "item-b", proposal_id: "proposal-1", position: 0 } },
			{ table: "ai_proposal_items", row: { id: "item-a", proposal_id: "proposal-1", position: 0 } },
		], { ownerUserId: "v2-owner" });

		expect(outcomes.map((outcome) => outcome.payload?.position)).toEqual([1, 0]);
	});

	test("keeps same-name players from different countries as separate entities", () => {
		const outcomes = planRows([
			{ table: "football_entities", row: { id: "player-uruguay", entity_kind: "player", display_name: "Same Player", country_region: "Uruguay" } },
			{ table: "football_entities", row: { id: "player-argentina", entity_kind: "player", display_name: "Same Player", country_region: "Argentina" } },
		], { ownerUserId: "v2-owner" });

		expect(outcomes.every((outcome) => outcome.outcome === "MAPPED")).toBe(true);
	});

	test("proves companyEnrichment and contactFact are unreachable from current V1 mappings", () => {
		const dynamicRows = [
			{ table: "football_organization_details", row: { entity_id: "agency-1", organization_type: "AGENCY" } },
			{ table: "football_organization_details", row: { entity_id: "club-1", organization_type: "CLUB" } },
			{ table: "football_person_details", row: { entity_id: "player-1", role_title: "Player" } },
			{ table: "football_person_details", row: { entity_id: "agent-1", role_title: "Agent" } },
			{ table: "football_player_details", row: { entity_id: "player-1" } },
		];
		const currentTargets = new Set([
			...businessV1Rows.map((item) => mappingTargetForTest(item.table, item.row)),
			...dynamicRows.map((item) => mappingTargetForTest(item.table, item.row)),
		]);
		expect(currentTargets.has("companyEnrichment")).toBe(false);
		expect(currentTargets.has("contactFact")).toBe(false);
		expect(currentTargets).toEqual(expect.not.arrayContaining(["companyEnrichment", "contactFact"]));
	});
});
