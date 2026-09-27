import { describe, expect, test } from "bun:test";
import {
	coldOutreachReplyWhere,
	coldOutreachSentWhere,
} from "../src/operations/outreach-metrics";

describe("cold outreach operational metrics", () => {
	const start = new Date("2026-09-21T00:00:00.000Z");

	test("counts only cold outreach deliveries sent after the day boundary", () => {
		expect(coldOutreachSentWhere(start)).toEqual({
			draft: { coldOutreach: true },
			sentAt: { gte: start },
		});
	});

	test("counts replies only from cold outreach deliveries", () => {
		expect(coldOutreachReplyWhere(start)).toEqual({
			draft: { coldOutreach: true },
			status: "REPLIED",
			replyIntent: {
				in: [
					"HUMAN_POSITIVE",
					"HUMAN_NEUTRAL",
					"HUMAN_NEGATIVE",
					"REFERRAL_OR_ROUTING",
				],
			},
			updatedAt: { gte: start },
		});
	});
});
