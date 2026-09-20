import { describe, expect, test } from "bun:test";
import {
	classifyProspectBacklogRoute,
	validatePreparedOutreach,
} from "../src/prospect-backlog";

describe("prospect backlog route semantics", () => {
	test("keeps mailbox type separate from CONTACT_ONCE for a named route", () => {
		expect(
			classifyProspectBacklogRoute({
				type: "EMAIL",
				value: "boaz@boazgoren.com",
				linkedEntityKeys: ["AGT-0072", "AGY-0048"],
				entityNames: ["Boaz Goren", "BG Sports"],
				routeLabel: "Published professional email",
			}),
		).toEqual({
			mailboxType: "PERSONAL",
			mailboxTypeEvidence:
				"Published professional route with person and domain-name evidence.",
			routeUsage: "CONTACT_ONCE",
		});
	});

	test("classifies general and role mailboxes without pretending they are personal", () => {
		expect(
			classifyProspectBacklogRoute({
				type: "EMAIL",
				value: "office@beckster.international",
				linkedEntityKeys: ["AGT-0109", "AGT-0426", "AGY-0043"],
				entityNames: ["Mikkel Beck", "Beckster International"],
			}).mailboxType,
		).toBe("GENERAL");
		expect(
			classifyProspectBacklogRoute({
				type: "EMAIL",
				value: "brazil@rocnation.com",
				linkedEntityKeys: ["AGT-0010", "AGY-0326"],
				entityNames: ["Alan Redmond", "Roc Nation Sports"],
			}).mailboxType,
		).toBe("ROLE");
		expect(
			classifyProspectBacklogRoute({
				type: "EMAIL",
				value: "baseinfo@caa.com",
				linkedEntityKeys: ["AGT-0343", "AGY-0068"],
				entityNames: ["Leon Angel", "CAA Base"],
			}).mailboxType,
		).toBe("ROLE");
	});

	test("does not infer personal ownership from a named agency address", () => {
		expect(
			classifyProspectBacklogRoute({
				type: "EMAIL",
				value: "diogohenriques@sportsbloom.com",
				linkedEntityKeys: ["AGT-0140", "AGY-0362"],
				entityNames: ["Diogo Correia Henriques", "SPORTSBLOOM"],
			}).mailboxType,
		).toBe("UNKNOWN");
		expect(
			classifyProspectBacklogRoute({
				type: "EMAIL",
				value: "starmakersagency@gmail.com",
				linkedEntityKeys: ["AGT-0006"],
				entityNames: ["Agustin Jimenez", "Star Makers Agency"],
			}).mailboxType,
		).toBe("GENERAL");
	});

	test("marks a single-entity route reusable independently of mailbox type", () => {
		expect(
			classifyProspectBacklogRoute({
				type: "EMAIL",
				value: "boaz@boazgoren.com",
				linkedEntityKeys: ["AGT-0072"],
				entityNames: ["Boaz Goren"],
			}).routeUsage,
		).toBe("REUSABLE");
	});
});

describe("broadened outreach quality gate", () => {
	const evidence = {
		language: "English",
		whyNow:
			"The player's public profile is growing faster than the consistency of the media around his current first-team role, creating a specific opportunity to improve the next matchday cycle.",
		researchSummary:
			"The agency roster and current club profile were checked against official club material and the agency's public roster; the route and player relationship are sufficiently supported for review.",
		sourceUrls: ["https://example.com/official-source"],
	};

	test("accepts a specific media-gap hook without requiring a news event", () => {
		expect(
			validatePreparedOutreach({ ...evidence, hookType: "MEDIA_GAP" }),
		).toEqual({ valid: true });
	});

	test("accepts an existing-relationship hook with evidence", () => {
		expect(
			validatePreparedOutreach({
				...evidence,
				hookType: "EXISTING_RELATIONSHIP",
			}),
		).toEqual({ valid: true });
	});

	test("rejects weak or unsupported preparation", () => {
		expect(
			validatePreparedOutreach({
				...evidence,
				whyNow: "Good opportunity.",
				hookType: "OTHER_SPECIFIC_OPPORTUNITY",
			}),
		).toEqual({
			valid: false,
			reason: "Why-now reasoning is not specific enough.",
		});
	});
});
