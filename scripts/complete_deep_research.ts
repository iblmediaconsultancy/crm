import { db } from "../packages/db/src/index";
import { findProtectedPlayerMatches } from "../packages/db/src/player-protection";

const filename = "IBL_Football_CRM_Master_Deduplicated_Expanded(1).xlsx";
const runLabel = "Atlas deep research review 2026-09-20";
const batchSize = 25;

const asObject = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};

function collectUrls(rawValue: unknown): string[] {
	const urls = new Set<string>();
	for (const value of Object.values(asObject(rawValue))) {
		if (typeof value !== "string") continue;
		for (const match of value.matchAll(/https?:\/\/[^\s;,]+/gi))
			urls.add(match[0].replace(/[).]+$/, ""));
	}
	return [...urls];
}

function sourceClass(
	url: string,
): "OFFICIAL" | "DIRECTORY" | "SOCIAL" | "NETWORK" | "OTHER" {
	try {
		const host = new URL(url).hostname.replace(/^www\./, "");
		if (host === "footballagencies.com") return "DIRECTORY";
		if (host.includes("instagram.com")) return "SOCIAL";
		if (host.includes("linkedin.com")) return "NETWORK";
		return "OFFICIAL";
	} catch {
		return "OTHER";
	}
}

async function loadEligible(batchId: string) {
	return db.prospectBacklogItem.findMany({
		where: { batchId, state: "ELIGIBLE" },
		include: {
			routes: { include: { route: true } },
			sourceRecords: { take: 1 },
		},
		orderBy: [{ commercialScore: "desc" }, { canonicalKey: "asc" }],
	});
}

async function safetyForEmail(email: string) {
	const domain = email.split("@")[1] ?? "";
	const [
		contactRoute,
		suppressedEmail,
		suppressedDomain,
		activeLeadCount,
		threadCount,
	] = await Promise.all([
		db.contactRoute.findUnique({
			where: {
				type_normalizedValue: { type: "EMAIL", normalizedValue: email },
			},
			select: { id: true },
		}),
		db.suppressedContact.findUnique({
			where: { email },
			select: { email: true },
		}),
		db.suppressedDomain.findUnique({
			where: { domain },
			select: { domain: true },
		}),
		db.lead.count({
			where: {
				contact: {
					contactRoutes: {
						some: { type: "EMAIL", normalizedValue: email },
					},
				},
				status: { notIn: ["ARCHIVED", "DISQUALIFIED"] },
			},
		}),
		db.emailThread.count({
			where: {
				contact: {
					contactRoutes: {
						some: { type: "EMAIL", normalizedValue: email },
					},
				},
			},
		}),
	]);
	return {
		contactRoute: Boolean(contactRoute),
		suppressedEmail: Boolean(suppressedEmail),
		suppressedDomain: Boolean(suppressedDomain),
		activeLeadCount,
		threadCount,
	};
}

async function resolveItem(
	item: Awaited<ReturnType<typeof loadEligible>>[number],
) {
	const now = new Date();
	const raw = asObject(item.sourceRecords[0]?.rawValues);
	const sourceUrls = collectUrls(item.sourceRecords[0]?.rawValues);
	const classes = sourceUrls.map((url) => sourceClass(url));
	const sourceCounts = classes.reduce<Record<string, number>>(
		(counts, value) => {
			counts[value] = (counts[value] ?? 0) + 1;
			return counts;
		},
		{},
	);
	const safety = item.normalizedEmail
		? await safetyForEmail(item.normalizedEmail)
		: null;
	const protectedMatches = await findProtectedPlayerMatches(db, [
		item.displayName,
	]);
	const freeMail =
		/^(gmail|googlemail|hotmail|icloud|live|outlook|proton|protonmail|wanadoo|yahoo)\./.test(
			item.normalizedEmail?.split("@")[1] ?? "",
		);
	let reason = "CURRENT_PLAYER_RELATIONSHIP_UNVERIFIED";
	if (item.entityType === "PLAYER" && protectedMatches.length > 0)
		reason = "DO_NOT_PROSPECT_PLAYER";
	else if (safety?.suppressedEmail || safety?.suppressedDomain)
		reason = "SUPPRESSION_OR_DOMAIN_BLOCK";
	else if (
		safety?.contactRoute ||
		(safety?.activeLeadCount ?? 0) > 0 ||
		(safety?.threadCount ?? 0) > 0
	)
		reason = "EXISTING_CRM_RELATIONSHIP";
	else if (freeMail) reason = "ROUTE_DOMAIN_UNSAFE";
	else if (item.entityType === "COMPANY")
		reason = "PLAYER_RELATIONSHIP_NOT_IDENTIFIED";
	else if (!sourceCounts.OFFICIAL) reason = "SOURCE_QUALITY_INSUFFICIENT";
	const state =
		reason === "DO_NOT_PROSPECT_PLAYER" ? "SUPPRESSED" : "NEEDS_ENRICHMENT";
	await db.prospectBacklogEnrichment.create({
		data: {
			itemId: item.id,
			runLabel,
			status: reason === "DO_NOT_PROSPECT_PLAYER" ? "REJECTED" : "DEFERRED",
			routeConfidence: item.routeConfidence,
			researchConfidence: sourceCounts.OFFICIAL ? "MEDIUM" : "LOW",
			commercialPriority: item.commercialPriority,
			commercialScore: item.commercialScore,
			tier: item.tier,
			notes:
				"Deep-research gate reviewed persisted route, source provenance, CRM safety and player-entry evidence.",
			missingReason: reason,
			sourceUrls,
			evidence: {
				stage: "DEEP_RESEARCH_GATE",
				entityType: item.entityType,
				sourceCounts,
				mailboxType:
					item.routes.find((link) => link.route.type === "EMAIL")?.route
						.mailboxType ?? "UNKNOWN",
				protectedMatches: protectedMatches.map((match) => match.displayName),
				rawIdentityFields: Object.keys(raw),
			},
		},
	});
	await db.prospectBacklogItem.update({
		where: { id: item.id },
		data: {
			state,
			lastProcessedAt: now,
			lastEnrichedAt: now,
			researchConfidence: sourceCounts.OFFICIAL ? "MEDIUM" : "LOW",
			enrichmentNotes: reason,
			enrichmentEvidence: {
				...((item.enrichmentEvidence as object) ?? {}),
				deepResearchGate: "COMPLETED_WITH_BLOCKER",
				deepResearchBlocker: reason,
				sourceCounts,
			},
			nextReviewAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
			reviewReason: reason,
		},
	});
	return reason;
}

async function main() {
	if (process.env.ATLAS_LIVE_OUTREACH_ENABLED !== "false")
		throw new Error("ATLAS_LIVE_OUTREACH_ENABLED must be explicitly false");
	const batch = await db.prospectSourceBatch.findFirst({
		where: { filename },
		orderBy: { importedAt: "desc" },
	});
	if (!batch) throw new Error("Workbook source batch not found");
	const items = await loadEligible(batch.id);
	const counts: Record<string, number> = {};
	for (let start = 0; start < items.length; start += batchSize) {
		const current = items.slice(start, start + batchSize);
		for (const item of current) {
			const reason = await resolveItem(item);
			counts[reason] = (counts[reason] ?? 0) + 1;
		}
		console.log(
			JSON.stringify({
				batch: Math.floor(start / batchSize) + 1,
				processed: Math.min(start + batchSize, items.length),
				total: items.length,
				counts,
			}),
		);
	}
	console.log(
		JSON.stringify({ runLabel, resolved: items.length, counts }, null, 2),
	);
}

try {
	await main();
} finally {
	await db.$disconnect();
}
