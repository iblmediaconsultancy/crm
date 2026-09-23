import { describe, expect, it } from "bun:test";
import { isManualReviewOutcome } from "../agent/lib/linkedin-browser-adapter";

describe("LinkedIn browser adapter outcomes", () => {
	it("routes security and ambiguous outcomes to manual review", () => {
		expect(
			isManualReviewOutcome({
				status: "AMBIGUOUS",
				errorCode: "CAPTCHA",
				observedAt: new Date(),
			}),
		).toBe(true);
	});

	it("accepts only confirmed outcomes as confirmed execution", () => {
		expect(
			isManualReviewOutcome({
				status: "CONFIRMED",
				observedAt: new Date(),
			}),
		).toBe(false);
	});
});
