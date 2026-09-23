import { describe, expect, it } from "bun:test";
import { classifyLinkedInInboxMessage } from "../agent/lib/linkedin-inbox-classification";

describe("LinkedIn inbox classification", () => {
	it("keeps questions and concrete next steps actionable", () => {
		expect(
			classifyLinkedInInboxMessage({
				body: "Would you be open to a call next week?",
				direction: "INBOUND",
			}),
		).toBe("ACTION_REQUIRED");
	});

	it("recognizes player and referral opportunities", () => {
		expect(
			classifyLinkedInInboxMessage({
				body: "I can refer a player from our academy.",
				direction: "INBOUND",
			}),
		).toBe("REFERRAL_OR_PLAYER_OPPORTUNITY");
	});

	it("recognizes warm off-platform handoffs", () => {
		expect(
			classifyLinkedInInboxMessage({
				body: "Here is my WhatsApp number; let's talk there.",
				direction: "INBOUND",
			}),
		).toBe("WARM_HANDOFF");
	});

	it("parks not-now replies without suppressing the relationship", () => {
		expect(
			classifyLinkedInInboxMessage({
				body: "Not now, maybe later this season.",
				direction: "INBOUND",
			}),
		).toBe("PARKED_NO_CURRENT_NEED");
	});

	it("distinguishes explicit rejection from a soft acknowledgement", () => {
		expect(
			classifyLinkedInInboxMessage({
				body: "Please do not contact me again.",
				direction: "INBOUND",
			}),
		).toBe("CLOSED_OR_DO_NOT_PUSH");
		expect(
			classifyLinkedInInboxMessage({
				body: "Thanks, nice to connect.",
				direction: "INBOUND",
			}),
		).toBe("POSITIVE_LIGHT");
	});

	it("does not turn an empty or unclear acknowledgement into an opportunity", () => {
		expect(
			classifyLinkedInInboxMessage({
				body: "Okay.",
				direction: "INBOUND",
			}),
		).toBe("AMBIGUOUS_OR_NEEDS_IHSAN");
	});
});
