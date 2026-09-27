import {
	type CommercialQualityResult,
	evaluateCommercialQuality,
	opportunityCollisionKey,
} from "../packages/db/src/commercial-quality";
import { db } from "../packages/db/src/index";

const targetOrganizations = new Set([
	"vision4soccer",
	"unio",
	"11mangmt",
	"cma group",
	"ifm m",
]);

function organizationKey(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
	if (normalized.includes("vision4soccer")) return "vision4soccer";
	if (normalized.includes("unio")) return "unio";
	if (normalized.includes("11mangmt") || normalized.includes("11 man"))
		return "11mangmt";
	if (normalized.includes("cma group")) return "cma group";
	if (normalized.includes("ifm m")) return "ifm m";
	return normalized;
}

function organizationFromName(value: string): string | null {
	const match = value.match(/another (.+?) player may be more relevant/i);
	return match?.[1]?.trim() ?? null;
}

function playerFromSubject(value: string): string | null {
	const normalized = value.replace(/[’]/g, "'").trim();
	const media = normalized.match(
		/^how (?:is|are you handling) (.+?)'s media handled/i,
	);
	if (media?.[1]) return media[1].trim();
	const possessive = normalized.match(
		/^(.+?)'s (?:move|new|current|start|world cup)/i,
	);
	if (possessive?.[1]) return possessive[1].trim();
	const at = normalized.match(/^(.+?) at /i);
	if (at?.[1]) return at[1].trim();
	return null;
}

function clubFromSubject(value: string): string | null {
	const match = value.match(/\b(?:at|to) (.+)$/i);
	return match?.[1]?.replace(/[?.]+$/, "").trim() ?? null;
}

function whyNowFromSubject(value: string): boolean {
	return /\b(?:current|new|move|start|world cup|season)\b/i.test(value);
}

function reasonCounts(
	results: CommercialQualityResult[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const result of results) {
		for (const item of result.reasons)
			counts[item.code] = (counts[item.code] ?? 0) + 1;
	}
	return counts;
}

const rows = await db.outboundDelivery.findMany({
	where: { status: "SENT" },
	orderBy: { sentAt: "desc" },
	take: 90,
	select: {
		id: true,
		sentAt: true,
		draft: {
			select: {
				subject: true,
				body: true,
				language: true,
				lead: {
					select: {
						id: true,
						name: true,
						company: { select: { name: true, domain: true } },
						contact: {
							select: {
								company: { select: { name: true, domain: true } },
							},
						},
					},
				},
				recipientRoute: {
					select: { value: true, normalizedValue: true },
				},
			},
		},
	},
});

const prepared = rows.map((row) => {
	const subject = row.draft.subject ?? "";
	const body = row.draft.body;
	const lead = row.draft.lead;
	const routeDomain = row.draft.recipientRoute?.normalizedValue
		.split("@")
		.at(-1);
	const organization =
		lead?.company?.name ??
		lead?.contact?.company?.name ??
		(lead ? organizationFromName(lead.name) : null) ??
		routeDomain ??
		"";
	const player = playerFromSubject(subject) ?? "";
	const club = clubFromSubject(subject);
	return {
		id: row.id,
		sentAt: row.sentAt,
		organization,
		organizationKey: organizationKey(organization),
		player,
		club,
		subject,
		body,
	};
});

const collisionCounts = new Map<string, number>();
for (const row of prepared) {
	if (!row.organization || !row.player) continue;
	const key = opportunityCollisionKey({
		organization: row.organization,
		playerOrOpportunity: row.player,
		campaignPurpose: "player media support",
	});
	collisionCounts.set(key, (collisionCounts.get(key) ?? 0) + 1);
}

const seenOrganizationKeys = new Map<string, Set<string>>();
const results = prepared.map((row) => {
	const collisionKey =
		row.organization && row.player
			? opportunityCollisionKey({
					organization: row.organization,
					playerOrOpportunity: row.player,
					campaignPurpose: "player media support",
				})
			: "";
	const organizationOpportunitySet =
		seenOrganizationKeys.get(row.organizationKey) ?? new Set<string>();
	const result = evaluateCommercialQuality({
		organization: row.organization,
		playerOrOpportunity: row.player,
		campaignPurpose: "player media support",
		currentClub: row.club,
		currentClubVerified: false,
		currentClubRequired: Boolean(row.club),
		copyReferencesCurrentClub: Boolean(row.club),
		identityResolved: Boolean(row.player),
		organizationResolved: Boolean(row.organization),
		playerOrganizationAssociationResolved: Boolean(row.organization),
		whyNowSupported: false,
		whyNowRequired: whyNowFromSubject(row.subject),
		placeholderHook: /client roster/i.test(row.subject),
		subject: row.subject,
		body: row.body,
		opportunityAlreadyActive: (collisionCounts.get(collisionKey) ?? 0) > 1,
		activeOrganizationOpportunityCount: organizationOpportunitySet.size,
		language: { organizationName: row.organization },
	});
	if (collisionKey) organizationOpportunitySet.add(collisionKey);
	seenOrganizationKeys.set(row.organizationKey, organizationOpportunitySet);
	return result;
});

const organizations = [...new Set(prepared.map((row) => row.organizationKey))]
	.filter((key) => targetOrganizations.has(key))
	.map((key) => {
		const indices = prepared.flatMap((row, index) =>
			row.organizationKey === key ? [index] : [],
		);
		const organizationResults = indices.map((index) => results[index]);
		return {
			organization: prepared[indices[0]]?.organization ?? key,
			count: organizationResults.length,
			statuses: organizationResults.reduce<Record<string, number>>(
				(counts, result) => {
					counts[result.status] = (counts[result.status] ?? 0) + 1;
					return counts;
				},
				{},
			),
			reasons: reasonCounts(organizationResults),
		};
	});

const enrichmentHolds = results.filter(
	(result) => result.status === "HOLD_NEEDS_ENRICHMENT",
);
const deterministicDutchRoutes = prepared.filter((row) =>
	/\b(?:vision4soccer|vvcs)\b/i.test(row.organization),
).length;

console.log(
	JSON.stringify(
		{
			audited: rows.length,
			statuses: results.reduce<Record<string, number>>((counts, result) => {
				counts[result.status] = (counts[result.status] ?? 0) + 1;
				return counts;
			}, {}),
			reasons: reasonCounts(results),
			duplicateCollisionKeys: [...collisionCounts.entries()].filter(
				([, count]) => count > 1,
			),
			enrichment: {
				recoverableHolds: enrichmentHolds.length,
				deterministicDutchRoutes,
				fullyResolvedByDeterministicEvidence: 0,
				note: "No external research is performed by this read-only audit; a hold is counted as resolved only after cited evidence is recorded and the gate is reevaluated.",
			},
			organizations,
		},
		null,
		2,
	),
);
await db.$disconnect();
