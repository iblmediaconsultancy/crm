import { describe, expect, it } from "bun:test";
import { channelStatusForClassification } from "../src/linkedin/linkedin-channel.service";

describe("LinkedIn channel handoff policy", () => {
	it("keeps specific-player and referral conversations active", () => {
		expect(
			channelStatusForClassification("REFERRAL_OR_PLAYER_OPPORTUNITY"),
		).toBe("ACTIVE_HUMAN_CONVERSATION");
	});

	it("keeps warm handoffs escalated", () => {
		expect(channelStatusForClassification("WARM_HANDOFF")).toBe("NEEDS_IHSAN");
	});

	it("keeps ambiguous classifications escalated", () => {
		expect(channelStatusForClassification("AMBIGUOUS_OR_NEEDS_IHSAN")).toBe(
			"NEEDS_IHSAN",
		);
	});
});
