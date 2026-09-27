import { describe, expect, test } from "bun:test";
import {
	assertPreparedPlayerAllowed,
	isProtectedPlayerContact,
	normalizePlayerName,
} from "../src/player-protection";

describe("player-level outreach protection", () => {
	test("normalizes diacritics for authoritative player identity matching", () => {
		expect(normalizePlayerName("Admir Bristrić")).toBe("admir bristric");
	});

	test("blocks a protected player hook in prepared outreach", async () => {
		const client = {
			prospectPlayerProtection: {
				findMany: async () => [
					{
						id: "protected-esmir",
						displayName: "Esmir Bajraktarević",
						normalizedName: "esmir bajraktarevic",
						state: "DO_NOT_PROSPECT_PLAYER",
						reason: "client",
						source: "IHSAN_CONFIRMED",
					},
				],
			},
		};
		await expect(
			assertPreparedPlayerAllowed(client, [
				"Esmir Bajraktarević is the public hook; ask about the wider roster.",
			]),
		).rejects.toThrow("Protected player cannot be prepared for prospecting");
	});

	test("matches explicitly stored spelling aliases", async () => {
		const client = {
			prospectPlayerProtection: {
				findMany: async () => [
					{
						id: "protected-cristian",
						displayName: "Cristian Volpato",
						normalizedName: "cristian volpato",
						state: "DO_NOT_PROSPECT_PLAYER",
						reason: "client",
						source: "IHSAN_CONFIRMED",
						aliases: [
							{
								displayName: "Christian Volpato",
								normalizedName: "christian volpato",
							},
						],
					},
				],
			},
		};
		await expect(
			assertPreparedPlayerAllowed(client, ["Christian Volpato is the hook."]),
		).rejects.toThrow("Protected player cannot be prepared for prospecting");
	});

	test("does not block an unrelated player or an agency contact", async () => {
		const protectionClient = {
			prospectPlayerProtection: {
				findMany: async () => [
					{
						id: "protected-esmir",
						displayName: "Esmir Bajraktarević",
						normalizedName: "esmir bajraktarevic",
						state: "DO_NOT_PROSPECT_PLAYER",
						reason: "client",
						source: "IHSAN_CONFIRMED",
					},
				],
			},
		};
		await expect(
			assertPreparedPlayerAllowed(protectionClient, [
				"Mikey Moore is the hook.",
			]),
		).resolves.toBeUndefined();

		const contactClient = {
			footballPlayer: {
				findUnique: async ({ where }: { where: { contactId: string } }) =>
					where.contactId === "agent" ? null : { contactId: where.contactId },
			},
			prospectPlayerProtection: {
				findFirst: async () => ({ id: "protected-esmir" }),
			},
		};
		await expect(
			isProtectedPlayerContact(contactClient, "agent", "Esmir Bajraktarević"),
		).resolves.toBe(false);
		await expect(
			isProtectedPlayerContact(contactClient, "player", "Esmir Bajraktarević"),
		).resolves.toBe(true);
	});
});
