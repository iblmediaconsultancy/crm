import { describe, expect, it } from "bun:test";
import {
	hasSubstantiveLinkedInHistory,
	isSubstantiveLinkedInActivity,
} from "../src/linkedin/linkedin-history";

describe("LinkedIn historical activity detection", () => {
	it("recognizes verified inbound and outbound history", () => {
		expect(
			isSubstantiveLinkedInActivity({
				subject: "LinkedIn outbound message · verified",
				body: "Previous outreach",
				meta: { channel: "LINKEDIN", direction: "OUTBOUND" },
			}),
		).toBe(true);
		expect(
			hasSubstantiveLinkedInHistory([
				{
					subject: "LinkedIn inbound message · verified",
					body: "Thanks for reaching out",
					meta: { channel: "LINKEDIN", direction: "INBOUND" },
				},
			]),
		).toBe(true);
	});

	it("ignores connection-request activities and unrelated activities", () => {
		expect(
			hasSubstantiveLinkedInHistory([
				{
					subject: "LinkedIn connection request",
					body: "",
					meta: {
						channel: "LINKEDIN",
						action: "CONNECTION_REQUEST",
					},
				},
				{
					subject: "Email outbound message",
					body: "Unrelated",
					meta: { channel: "EMAIL", direction: "OUTBOUND" },
				},
			]),
		).toBe(false);
	});

	it("counts a connection-request note as substantive history", () => {
		expect(
			isSubstantiveLinkedInActivity({
				subject: "LinkedIn connection request",
				body: "I work with players on personal branding.",
				meta: {
					channel: "LINKEDIN",
					action: "CONNECTION_REQUEST",
					note: "I work with players on personal branding.",
				},
			}),
		).toBe(true);
		expect(
			isSubstantiveLinkedInActivity({
				subject: "LinkedIn connection request",
				body: "Connection request sent without a note",
				meta: { channel: "LINKEDIN", action: "CONNECTION_REQUEST" },
			}),
		).toBe(false);
	});

	it("recognizes legacy LinkedIn subjects when direction metadata is present", () => {
		expect(
			isSubstantiveLinkedInActivity({
				subject: "LinkedIn outbound message · workflow evidence",
				body: "Earlier conversation",
				meta: { direction: "OUTBOUND", historical: true },
			}),
		).toBe(true);
	});
});
