import { describe, expect, it } from "bun:test";
import {
	hasBlockedPricingLanguage,
	isWithinAtlasWorkingHours,
	sendAtlasEmail,
} from "../agent/lib/atlas-outreach";

describe("Atlas outreach policy", () => {
	it("keeps weekdays inside the configured Amsterdam window", () => {
		expect(
			isWithinAtlasWorkingHours(
				new Date("2026-09-18T08:00:00.000Z"),
				"Europe/Amsterdam",
				540,
				1080,
			),
		).toBe(true);
		expect(
			isWithinAtlasWorkingHours(
				new Date("2026-09-18T17:30:00.000Z"),
				"Europe/Amsterdam",
				540,
				1080,
			),
		).toBe(false);
		expect(
			isWithinAtlasWorkingHours(
				new Date("2026-09-19T09:00:00.000Z"),
				"Europe/Amsterdam",
				540,
				1080,
			),
		).toBe(false);
	});

	it("blocks commercial pricing terms and amounts without substring false positives", () => {
		for (const value of [
			"feels",
			"feeling",
			"coffee",
			"feedback",
			"Would a short call be useful?",
		]) {
			expect(hasBlockedPricingLanguage(value)).toBe(false);
		}
		for (const value of [
			"fee",
			"fees",
			"our fee",
			"monthly fee",
			"price",
			"pricing",
			"cost",
			"package price",
			"€500",
			"$500",
			"£500",
			"500 per month",
			"500/month",
			"a discount",
			"our rates",
			"the package",
		]) {
			expect(hasBlockedPricingLanguage(value)).toBe(true);
		}
	});

	it("fails closed while live outreach is disabled", async () => {
		const ctx = {
			session: {
				auth: {
					current: {
						attributes: {
							purpose: "atlas-outreach",
							taskKind: "atlas-outreach",
						},
					},
					initiator: null,
				},
			},
		};
		await expect(
			sendAtlasEmail(ctx, {
				leadId: "lead",
				routeId: "route",
				subject: "Hello",
				body: "A short introduction.",
				language: "English",
				idempotencyKey: "test-disabled",
			}),
		).rejects.toThrow("ATLAS_LIVE_OUTREACH_ENABLED is false");
	});
});
