import { describe, expect, it } from "bun:test";
import {
	channelStatusForClassification,
	technicalRecoveryState,
} from "../src/linkedin/linkedin-channel.service";

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

	it("restores cold eligibility when technical recovery has no confirmed message", () => {
		expect(
			technicalRecoveryState([
				{
					direction: "OUTBOUND",
					status: "FAILED",
					occurredAt: null,
				},
			]),
		).toEqual({
			conversationStatus: "ACTIVE",
			conversationClassification: "ACTION_REQUIRED",
			channelStatus: "COLD_ELIGIBLE",
			reasonSuffix: "NO_CONFIRMED_MESSAGE",
		});
	});

	it("preserves human engagement when technical recovery has confirmed history", () => {
		const inboundAt = new Date("2026-09-27T10:00:00.000Z");
		const outboundAt = new Date("2026-09-27T10:01:00.000Z");
		expect(
			technicalRecoveryState([
				{
					direction: "INBOUND",
					status: "RECEIVED",
					occurredAt: inboundAt,
				},
				{
					direction: "OUTBOUND",
					status: "SENT",
					occurredAt: outboundAt,
				},
			]),
		).toMatchObject({
			conversationStatus: "WAITING_ON_PROSPECT",
			conversationClassification: "WAITING_ON_PROSPECT",
			channelStatus: "WAITING_ON_PROSPECT",
			reasonSuffix: "REAL_OUTBOUND_HISTORY",
		});
		expect(
			technicalRecoveryState([
				{
					direction: "OUTBOUND",
					status: "SENT",
					occurredAt: outboundAt,
				},
				{
					direction: "INBOUND",
					status: "RECEIVED",
					occurredAt: new Date("2026-09-27T10:02:00.000Z"),
				},
			]),
		).toMatchObject({
			conversationStatus: "ACTIVE",
			conversationClassification: "ACTION_REQUIRED",
			channelStatus: "ACTIVE_HUMAN_CONVERSATION",
			reasonSuffix: "REAL_INBOUND_HISTORY",
		});
	});
});
