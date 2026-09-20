import type { Db } from "./client";

export const PROTECTED_PLAYER_STATE = "DO_NOT_PROSPECT_PLAYER" as const;

type PlayerProtectionClient = Pick<
	Db,
	"prospectPlayerProtection" | "footballPlayer"
>;

export function normalizePlayerName(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

export async function findProtectedPlayerMatches(
	client: Pick<Db, "prospectPlayerProtection">,
	values: string[],
) {
	const protections = await client.prospectPlayerProtection.findMany({
		where: { active: true, state: PROTECTED_PLAYER_STATE },
		select: {
			id: true,
			displayName: true,
			normalizedName: true,
			state: true,
			reason: true,
			source: true,
			aliases: { select: { displayName: true, normalizedName: true } },
		},
		orderBy: { displayName: "asc" },
	});
	const normalizedValues = values
		.map(normalizePlayerName)
		.filter((value) => value.length > 0);
	return protections.filter((protection) =>
		normalizedValues.some((value) =>
			[
				protection.normalizedName,
				...(protection.aliases ?? []).map((alias) => alias.normalizedName),
			].some((name) => value === name || value.includes(name)),
		),
	);
}

export async function isProtectedPlayerContact(
	client: PlayerProtectionClient,
	contactId: string,
	fullName: string,
): Promise<boolean> {
	const player = await client.footballPlayer.findUnique({
		where: { contactId },
		select: { contactId: true },
	});
	if (!player) return false;
	const normalizedName = normalizePlayerName(fullName);
	const protection = await client.prospectPlayerProtection.findFirst({
		where: {
			active: true,
			state: PROTECTED_PLAYER_STATE,
			OR: [
				{ contactId },
				...(normalizedName ? [{ normalizedName }] : []),
				...(normalizedName ? [{ aliases: { some: { normalizedName } } }] : []),
			],
		},
		select: { id: true },
	});
	return Boolean(protection);
}

export async function assertPreparedPlayerAllowed(
	client: Pick<Db, "prospectPlayerProtection">,
	values: string[],
): Promise<void> {
	const matches = await findProtectedPlayerMatches(client, values);
	if (matches.length > 0) {
		throw new Error(
			`Protected player cannot be prepared for prospecting: ${matches.map((match) => match.displayName).join(", ")}`,
		);
	}
}
