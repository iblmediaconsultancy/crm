import { db } from "../packages/db/src/index";
import { findProtectedPlayerMatches } from "../packages/db/src/player-protection";

const filename = "IBL_Football_CRM_Master_Deduplicated_Expanded(1).xlsx";
const defaultRunLabel = "Atlas fast eligibility 2026-09-20";
const defaultBatchSize = 100;
const defaultLimit = 500;

type Candidate = Awaited<ReturnType<typeof loadItems>>[number];

type FastDecision =
	| {
			kind: "PASS";
			route: Candidate["routes"][number]["route"];
			sourceUrls: string[];
	  }
	| { kind: "DEFER"; reason: string; sourceUrls: string[] }
	| {
			kind: "SUPPRESS";
			reason: string;
			sourceUrls: string[];
			evidence: unknown;
	  };

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

function screeningScore(item: Candidate): number {
	const raw = JSON.stringify(
		asObject(item.sourceRecords[0]?.rawValues),
	).toLowerCase();
	const route = item.routes.find((link) => link.route.type === "EMAIL")?.route;
	const domain = item.normalizedEmail?.split("@")[1] ?? "";
	const freeMail =
		/^(gmail|googlemail|hotmail|icloud|live|outlook|proton|protonmail|wanadoo|yahoo)\./.test(
			domain,
		);
	let score = 0;
	if (item.agencyName) score += 3;
	if (item.normalizedEmail) score += 3;
	if (route) score += 3;
	if (route?.mailboxType && route.mailboxType !== "UNKNOWN") score += 2;
	if (route?.routeUsage === "CONTACT_ONCE") score += 1;
	if (item.normalizedLinkedInUrl) score += 2;
	if (collectUrls(item.sourceRecords[0]?.rawValues).length > 0) score += 2;
	if (/verified|official|professional|agent|agency|player|roster/.test(raw))
		score += 2;
	if (freeMail && route?.mailboxType !== "PERSONAL") score -= 4;
	return score;
}

function confidenceForRoute(
	route: Candidate["routes"][number]["route"] | undefined,
): string {
	if (!route) return "LOW";
	if (route.mailboxType === "UNKNOWN") return "MEDIUM";
	return "HIGH";
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
			select: { id: true, contactId: true, companyId: true },
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
		contactRoute,
		suppressedEmail,
		suppressedDomain,
		activeLeadCount,
		threadCount,
	};
}

async function loadItems(batchId: string) {
	return db.prospectBacklogItem.findMany({
		where: {
			batchId,
			state: "NEEDS_ENRICHMENT",
			lastEnrichedAt: null,
			entityType: { in: ["PERSON", "COMPANY"] },
			normalizedEmail: { not: null },
		},
		include: {
			routes: { include: { route: true } },
			sourceRecords: { take: 1 },
		},
	});
}

async function decide(
	item: Candidate,
	reservedRoutes: Set<string>,
): Promise<FastDecision> {
	const sourceUrls = collectUrls(item.sourceRecords[0]?.rawValues);
	const route = item.routes.find((link) => link.route.type === "EMAIL")?.route;
	if (!route || !item.normalizedEmail)
		return { kind: "DEFER", reason: "PROFESSIONAL_ROUTE_MISSING", sourceUrls };

	const protectedMatches = await findProtectedPlayerMatches(db, [
		item.displayName,
	]);
	if (item.entityType === "PLAYER" && protectedMatches.length > 0)
		return {
			kind: "SUPPRESS",
			reason: "DO_NOT_PROSPECT_PLAYER",
			sourceUrls,
			evidence: {
				matchedPlayers: protectedMatches.map((match) => match.displayName),
			},
		};

	const safety = await safetyForEmail(item.normalizedEmail);
	if (safety.suppressedEmail || safety.suppressedDomain)
		return { kind: "DEFER", reason: "SUPPRESSION_OR_DOMAIN_BLOCK", sourceUrls };
	if (
		safety.contactRoute ||
		safety.activeLeadCount > 0 ||
		safety.threadCount > 0
	)
		return { kind: "DEFER", reason: "EXISTING_CRM_RELATIONSHIP", sourceUrls };

	if (
		route.routeUsage === "CONTACT_ONCE" &&
		reservedRoutes.has(route.normalizedValue)
	)
		return { kind: "DEFER", reason: "SHARED_ROUTE_NON_PRIMARY", sourceUrls };

	const domain = item.normalizedEmail.split("@")[1] ?? "";
	const freeMail =
		/^(gmail|googlemail|hotmail|icloud|live|outlook|proton|protonmail|wanadoo|yahoo)\./.test(
			domain,
		);
	if (freeMail && route.mailboxType !== "PERSONAL")
		return { kind: "DEFER", reason: "ROUTE_DOMAIN_UNSAFE", sourceUrls };

	return { kind: "PASS", route, sourceUrls };
}

async function writeEnrichment(
	item: Candidate,
	runLabel: string,
	decision: FastDecision,
	processedAt: Date,
) {
	const existing = await db.prospectBacklogEnrichment.findFirst({
		where: { itemId: item.id, runLabel },
		select: { id: true },
	});
	if (existing) return false;
	const route =
		decision.kind === "PASS"
			? decision.route
			: item.routes.find((link) => link.route.type === "EMAIL")?.route;
	const routeConfidence = confidenceForRoute(route);
	const commercialScore = screeningScore(item);
	const evidence = {
		stage: "FAST_ELIGIBILITY",
		mailboxType: route?.mailboxType ?? "UNKNOWN",
		routeUsage: route?.routeUsage ?? "CONTACT_ONCE",
		fastEligibility: decision.kind === "PASS",
		...(decision.kind === "SUPPRESS"
			? (decision.evidence as Record<string, unknown>)
			: {}),
	};
	await db.prospectBacklogEnrichment.create({
		data: {
			itemId: item.id,
			runLabel,
			status: decision.kind === "SUPPRESS" ? "REJECTED" : "DEFERRED",
			routeConfidence,
			researchConfidence: decision.sourceUrls.length > 0 ? "LOW-MEDIUM" : "LOW",
			commercialPriority: commercialScore >= 13 ? "HIGH" : "NORMAL",
			commercialScore,
			tier: "C",
			notes:
				"Fast eligibility completed from staged identity, route, CRM safety and provenance checks.",
			missingReason:
				decision.kind === "PASS" ? "DEEP_RESEARCH_REQUIRED" : decision.reason,
			sourceUrls: decision.sourceUrls,
			evidence,
		},
	});
	await db.prospectBacklogItem.update({
		where: { id: item.id },
		data: {
			state:
				decision.kind === "PASS"
					? "ELIGIBLE"
					: decision.kind === "SUPPRESS"
						? "SUPPRESSED"
						: "NEEDS_ENRICHMENT",
			lastProcessedAt: processedAt,
			lastEnrichedAt: processedAt,
			routeConfidence,
			researchConfidence: decision.sourceUrls.length > 0 ? "LOW-MEDIUM" : "LOW",
			commercialPriority: commercialScore >= 13 ? "HIGH" : "NORMAL",
			commercialScore,
			tier: "C",
			enrichmentNotes:
				decision.kind === "PASS"
					? "Fast eligibility passed; deep research is required before READY."
					: decision.reason,
			enrichmentEvidence: evidence,
			nextReviewAt:
				decision.kind === "PASS"
					? null
					: new Date(processedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
			reviewReason:
				decision.kind === "PASS"
					? "Fast eligibility passed; deep research must verify current player, agency, route and media opportunity before promotion."
					: decision.reason,
		},
	});
	return true;
}

async function rankReady(batchId: string) {
	const items = await db.prospectBacklogItem.findMany({
		where: { batchId, state: "READY" },
		include: { pilotItems: { orderBy: { rank: "asc" }, take: 1 } },
	});
	const confidence = (value: string | null) =>
		value === "HIGH"
			? 3
			: value === "MEDIUM-HIGH"
				? 2.5
				: value === "MEDIUM"
					? 2
					: 1;
	const ranked = items
		.map((item) => {
			const pilot = item.pilotItems[0];
			const score =
				confidence(item.routeConfidence) +
				confidence(item.researchConfidence) +
				(item.commercialScore ?? 0) / 20 +
				(pilot?.mailboxType === "PERSONAL" ? 2 : 1) +
				(pilot?.hookType ? 1 : 0);
			return { item, score };
		})
		.sort(
			(a, b) =>
				b.score - a.score ||
				a.item.canonicalKey.localeCompare(b.item.canonicalKey),
		);
	for (const [index, entry] of ranked.entries()) {
		await db.prospectBacklogItem.update({
			where: { id: entry.item.id },
			data: { tier: index < 5 ? "A" : index < 15 ? "B" : "C" },
		});
	}
	return ranked.map((entry, index) => ({
		key: entry.item.canonicalKey,
		name: entry.item.displayName,
		score: entry.score,
		tier: index < 5 ? "A" : index < 15 ? "B" : "C",
		routeConfidence: entry.item.routeConfidence,
		researchConfidence: entry.item.researchConfidence,
		commercialScore: entry.item.commercialScore,
	}));
}

async function main() {
	if (process.env.ATLAS_LIVE_OUTREACH_ENABLED !== "false")
		throw new Error("ATLAS_LIVE_OUTREACH_ENABLED must be explicitly false");
	const args = new Map<string, string>();
	for (let index = 0; index < process.argv.length; index += 1) {
		const value = process.argv[index];
		const next = process.argv[index + 1];
		if (value?.startsWith("--") && next && !next.startsWith("--"))
			args.set(value, next);
	}
	const limit = Math.min(Number(args.get("--fast-limit") ?? defaultLimit), 600);
	const batchSize = Math.min(
		Number(args.get("--batch-size") ?? defaultBatchSize),
		100,
	);
	const runLabel = args.get("--run-label") ?? defaultRunLabel;
	const batch = await db.prospectSourceBatch.findFirst({
		where: { filename },
		orderBy: { importedAt: "desc" },
	});
	if (!batch) throw new Error("Workbook source batch not found");
	const all = await loadItems(batch.id);
	const selected = all
		.map((item) => ({ item, score: screeningScore(item) }))
		.sort(
			(a, b) =>
				b.score - a.score ||
				a.item.canonicalKey.localeCompare(b.item.canonicalKey),
		)
		.slice(0, limit)
		.map((entry) => entry.item);
	const reservedRoutes = new Set<string>();
	const counts: Record<string, number> = {
		passed: 0,
		deferred: 0,
		suppressed: 0,
		persisted: 0,
	};
	const blockers: Record<string, number> = {};
	for (let start = 0; start < selected.length; start += batchSize) {
		for (const item of selected.slice(start, start + batchSize)) {
			const decision = await decide(item, reservedRoutes);
			if (decision.kind === "PASS")
				reservedRoutes.add(decision.route.normalizedValue);
			counts[
				decision.kind === "PASS"
					? "passed"
					: decision.kind === "SUPPRESS"
						? "suppressed"
						: "deferred"
			] += 1;
			if (decision.kind !== "PASS")
				blockers[decision.reason] = (blockers[decision.reason] ?? 0) + 1;
			if (await writeEnrichment(item, runLabel, decision, new Date()))
				counts.persisted += 1;
		}
	}
	const ready = await rankReady(batch.id);
	const states = await db.prospectBacklogItem.groupBy({
		by: ["state"],
		where: { batchId: batch.id },
		_count: { _all: true },
	});
	console.log(
		JSON.stringify(
			{
				batchId: batch.id,
				runLabel,
				availableUntouched: all.length,
				selected: selected.length,
				counts,
				blockers,
				reservedContactOnceRoutes: reservedRoutes.size,
				states: states.map((row) => ({
					state: row.state,
					count: row._count._all,
				})),
				readyTotal: ready.length,
				topReady: ready.slice(0, 20),
			},
			null,
			2,
		),
	);
}

try {
	await main();
} finally {
	await db.$disconnect();
}
