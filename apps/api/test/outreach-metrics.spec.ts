import { describe, expect, test } from "bun:test";
import { coldOutreachReplyWhere } from "../src/operations/outreach-metrics";

describe("cold outreach reply metrics", () => {
	test("counts human intents but excludes automatic replies", () => {
		const where = coldOutreachReplyWhere(new Date("2026-09-22T00:00:00Z"));
		expect(where).toMatchObject({
			status: "REPLIED",
			replyIntent: {
				in: [
					"HUMAN_POSITIVE",
					"HUMAN_NEUTRAL",
					"HUMAN_NEGATIVE",
					"REFERRAL_OR_ROUTING",
				],
			},
		});
		expect(
			(where.replyIntent as { in: string[] }).in.includes("AUTO_REPLY"),
		).toBe(false);
	});
});
