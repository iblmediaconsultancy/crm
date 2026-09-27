import { describe, expect, test } from "bun:test";
import {
	classifyProspectBacklogRoute,
	validatePreparedOutreach,
	validateReadyProspect,
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

	test("classifies common multilingual agency inboxes by function", () => {
		expect(
			classifyProspectBacklogRoute({
				type: "EMAIL",
				value: "contato@agency.example",
				linkedEntityKeys: ["AGY-0001"],
				entityNames: ["Example Agency"],
			}),
		).toMatchObject({ mailboxType: "GENERAL", routeUsage: "REUSABLE" });
		expect(
			classifyProspectBacklogRoute({
				type: "EMAIL",
				value: "comunicaciones@agency.example",
				linkedEntityKeys: ["AGY-0001", "AGT-0001"],
				entityNames: ["Example Agency"],
			}),
		).toMatchObject({ mailboxType: "ROLE", routeUsage: "CONTACT_ONCE" });
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
		subject: "A specific football opportunity",
		body: "Hi team, this is a short, specific message about a current media opportunity.",
		followUpApproach:
			"Follow up once with a useful question, then close the loop.",
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

	test("rejects em dash and en dash punctuation in outbound copy", () => {
		expect(
			validatePreparedOutreach({
				...evidence,
				body: "Hi team — this copy is not sendable.",
				hookType: "MEDIA_GAP",
			}),
		).toEqual({
			valid: false,
			reason: "External copy contains forbidden punctuation: em dash.",
		});
		expect(
			validatePreparedOutreach({
				...evidence,
				followUpApproach: "Follow up – then close the loop.",
				hookType: "MEDIA_GAP",
			}),
		).toEqual({
			valid: false,
			reason: "External copy contains forbidden punctuation: en dash.",
		});
	});

	test("rejects a generic roster placeholder from READY", () => {
		expect(
			validateReadyProspect({
				...evidence,
				hookType: "ROSTER_MEDIA_GAP",
				playerEntryPoint:
					"A current agency roster player to be nominated by the team",
				routeConfidence: "HIGH",
				researchConfidence: "HIGH",
				mailboxType: "GENERAL",
				routeUsage: "CONTACT_ONCE",
			}),
		).toEqual({
			valid: false,
			reasons: ["The player opportunity is a generic placeholder."],
		});
	});

	test("requires high-confidence identity and safety checks before READY", () => {
		const result = validateReadyProspect({
			...evidence,
			hookType: "CURRENT_EVENT",
			playerEntryPoint: "A named player at the verified current club",
			routeConfidence: "MEDIUM",
			researchConfidence: "MEDIUM",
			mailboxType: "UNKNOWN",
			routeUsage: "CONTACT_ONCE",
			existingRelationship: true,
		});
		expect(result).toEqual({
			valid: false,
			reasons: [
				"Route confidence must be HIGH before READY.",
				"Research confidence must be HIGH before READY.",
				"Mailbox type must be identified before READY.",
				"An existing relationship requires Ihsan review.",
			],
		});
	});

	test("keeps normal copy free of false pricing matches", () => {
		expect(
			validateReadyProspect({
				...evidence,
				hookType: "MEDIA_GAP",
				playerEntryPoint: "A named player entering a larger first-team role",
				routeConfidence: "HIGH",
				researchConfidence: "HIGH",
				mailboxType: "PERSONAL",
				routeUsage: "REUSABLE",
				body: "Hi team, the next matchday feels like a useful moment to compare notes.",
			}),
		).toEqual({ valid: true });
	});
});
