import { describe, expect, test } from "bun:test";
import { classifyInboundIntent } from "../src/mailbox/inbound-intent";

const safe = { flagged: false, signals: [] as never[] };

describe("inbound intent classification", () => {
	test("classifies delayed automatic acknowledgements separately", () => {
		const decision = classifyInboundIntent({
			subject: "Automatic reply: Evan Ferguson's current season at AS Roma",
			body: "Thank you for your email. Please expect a slight delay in our response.",
			fromName: "YMU Team",
			securityReview: safe,
		});
		expect(decision).toEqual({
			intent: "AUTO_REPLY",
			reason: "Automatic acknowledgement or delayed-response notice.",
			organizationWide: false,
			parked: false,
		});
	});

	test("classifies explicit agency-wide negative responses", () => {
		for (const [body, fromName] of [
			[
				"All our players are covered at this level, so we're not interested.",
				"EmartSoccer",
			],
			[
				"At the moment, we do not have a need for additional support in this area and are therefore not looking to pursue a collaboration.",
				"11 WINS Team",
			],
		] as const) {
			expect(
				classifyInboundIntent({
					subject: "Re: IBL Media",
					body,
					fromName,
					securityReview: safe,
				}),
			).toMatchObject({
				intent: "HUMAN_NEGATIVE",
				organizationWide: true,
				parked: false,
			});
		}
	});

	test("parks a not-now response instead of permanently suppressing it", () => {
		expect(
			classifyInboundIntent({
				subject: "Re: IBL Media",
				body: "Not now, perhaps later in the season.",
				fromName: "Agency",
				securityReview: safe,
			}),
		).toMatchObject({
			intent: "HUMAN_NEUTRAL",
			organizationWide: false,
			parked: true,
		});
	});

	test("does not classify quoted outbound copy as a new intent", () => {
		const decision = classifyInboundIntent({
			subject: "Re: IBL Media",
			body: "Thanks, we will keep this in mind.\n\n> All our players are covered at this level.",
			fromName: "Agency",
			securityReview: safe,
		});
		expect(decision.intent).toBe("HUMAN_NEUTRAL");
		expect(decision.organizationWide).toBe(false);
	});
});
