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

	it("blocks pricing language", () => {
		expect(hasBlockedPricingLanguage("Would a short call be useful?")).toBe(
			false,
		);
		expect(hasBlockedPricingLanguage("I can send pricing and fees.")).toBe(
			true,
		);
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
