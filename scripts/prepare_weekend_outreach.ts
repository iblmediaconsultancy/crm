import { randomUUID } from "node:crypto";
import { db } from "../packages/db/src/index";

const filename = "IBL_Football_CRM_Master_Deduplicated_Expanded(1).xlsx";
const pilotName = "Weekend preparation 2026-09-20";
const supportedLanguages = new Set(["English", "Dutch", "Turkish"]);
const senderSignature = "Kind regards,\n\nIhsan | Founder, IBL Media Consultancy\niblmedia.com\nWhatsApp: +31 6 27833383";

const candidates = [
	{
		key: "AGT-0226",
		email: "info@uniquesg.com",
		language: "English",
		routeQuality: "Published Unique Sports Group inbox; shared route linked to Gordon Stipic-Wipfler, another agent record, and the agency; CONTACT_ONCE required",
		researchSummary: "Unique's official transfer page records Mikey Moore's move to 1. FC Köln, and Tottenham's official report records his early Bundesliga debut assist. The workbook route is the agency inbox, not a verified personal address for Gordon. Confidence: high.",
		whyNow: "Mikey Moore has already made an impression at Köln with an assist on his Bundesliga debut after the loan move. That is a live opening for a conversation about keeping the player’s public story moving while the season is still taking shape, without making the email depend on Moore alone.",
		playerEntryPoint: "Mikey Moore is the current public hook; ask the Unique team whether he or another roster player is the right entry point.",
		credibilityAngle: "IBL can support the practical media layer around a move into a new league: matchday content, Stories and day-to-day account consistency.",
		ctaApproach: "Ask whether Moore already has support at Köln or whether another Unique player is more relevant.",
		ctaWhy: "The inbox is shared, so the message addresses the team and leaves room for the correct internal routing.",
		followUpApproach: "Follow-up one asks who owns Moore's day-to-day media; follow-up two is a short close-the-loop note before parking the route.",
		priority: "HIGH" as const,
		subject: "Mikey Moore's Köln start",
		body: "Hi Unique team,\n\nMikey Moore has already made an impression at Köln, assisting in his first Bundesliga appearance after joining on loan from Spurs. That gives him a live moment to build around while the season is still taking shape.\n\nIBL helps players keep the media side consistent around moves like this — matchday content, Stories and the day-to-day account work behind it. Is Mikey already supported there, or is another Unique player a better person to discuss?\n\n" + senderSignature,
		sourceUrls: [
			"https://www.uniquesg.com/transfers/",
			"https://www.tottenhamhotspur.com/news/1087833/mikey-joins-koln-on-loan",
			"https://www.tottenhamhotspur.com/news/1089363/moore-delights-for-koln-on-debut",
		],
	},
	{
		key: "AGT-0343",
		email: "baseinfo@caa.com",
		language: "English",
		routeQuality: "Published CAA Base inbox; shared route linked to Leon Angel, another agent record, and the agency; CONTACT_ONCE required",
		researchSummary: "CAA Base's current football page lists Cole Palmer among its clients. Chelsea's official September coverage records five league goals in four appearances, including four in one half against Brighton, and a Premier League Player of the Month nomination. The workbook route is shared and not verified as Leon Angel's personal inbox. Confidence: high.",
		whyNow: "Cole Palmer's current September run has created a concentrated public moment: five league goals in four appearances and a Player of the Month nomination. That gives CAA Base a specific reason to discuss how the attention is carried across the wider roster without assuming the shared inbox belongs to Palmer's direct representative.",
		playerEntryPoint: "Cole Palmer is the current public hook; ask whether Palmer or another CAA Base player is the more useful starting point.",
		credibilityAngle: "IBL already manages media for players across Premier League, international and emerging-talent environments, which is relevant to the ongoing channel work around a high-visibility run of form.",
		ctaApproach: "Ask how Cole's day-to-day media is currently handled, or whether another CAA Base player would be a better starting point.",
		ctaWhy: "The route is shared, so the CTA asks for the right internal entry point rather than assuming Leon Angel owns the player relationship.",
		followUpApproach: "Follow-up one asks who handles the player's media internally; follow-up two offers a short overview and then parks the shared route.",
		priority: "HIGH" as const,
		subject: "Cole Palmer's September run",
		body: "Hi CAA Base team,\n\nCole Palmer's September has been hard to miss: five league goals in four appearances, including four before half-time against Brighton, and a nomination for the Premier League Player of the Month. That is a natural point to look at how the attention is being carried across his channels.\n\nWe already manage media for players across Premier League, international and emerging-talent environments. How is Cole's day-to-day media currently handled, or would another CAA Base player be a more useful starting point?\n\n" + senderSignature,
		sourceUrls: [
			"https://www.caa.com/sportstalent/caa-base",
			"https://www.chelseafc.com/en/news/article/match-report-chelsea-4-2-brighton",
			"https://www.chelseafc.com/en/news/article/cole-palmer-nominated-for-septembers-premier-league-player-of-the-month",
		],
	},
] as const;

async function main() {
	if (process.env.ATLAS_LIVE_OUTREACH_ENABLED !== "false") {
		throw new Error("ATLAS_LIVE_OUTREACH_ENABLED must be explicitly false");
	}
	const batch = await db.prospectSourceBatch.findFirst({
		where: { filename },
		orderBy: { importedAt: "desc" },
	});
	if (!batch) throw new Error("The workbook source batch is not loaded.");

	const pilot = await db.prospectBacklogPilot.upsert({
		where: { batchId_name: { batchId: batch.id, name: pilotName } },
		create: { id: randomUUID(), batchId: batch.id, name: pilotName, status: "PREPARED" },
		update: { status: "PREPARED", preparedAt: new Date() },
	});

	const checks: Array<{ key: string; email: string; existingContactRoute: boolean; suppressedEmail: boolean; suppressedDomain: boolean; activeLeadCount: number; threadCount: number }> = [];
	for (const candidate of candidates) {
		if (!supportedLanguages.has(candidate.language)) throw new Error(`Unsupported language for ${candidate.key}`);
		const item = await db.prospectBacklogItem.findUnique({
			where: { batchId_canonicalKey: { batchId: batch.id, canonicalKey: candidate.key } },
			include: { routes: { include: { route: true } } },
		});
		if (!item) throw new Error(`Missing backlog item ${candidate.key}`);
		const route = item.routes.find((link) => link.route.type === "EMAIL" && link.route.normalizedValue === candidate.email);
		if (!route) throw new Error(`Missing staged email route for ${candidate.key}`);
		if (!route.route.contactOnce) throw new Error(`CONTACT_ONCE is not enforced for ${candidate.key}`);
		const [existingContactRoute, suppressedEmail, suppressedDomain, activeLeadCount, threadCount] = await Promise.all([
			db.contactRoute.findUnique({ where: { type_normalizedValue: { type: "EMAIL", normalizedValue: candidate.email } } }),
			db.suppressedContact.findUnique({ where: { email: candidate.email } }),
			db.suppressedDomain.findUnique({ where: { domain: candidate.email.split("@")[1] ?? "" } }),
			db.lead.count({ where: { contact: { contactRoutes: { some: { type: "EMAIL", normalizedValue: candidate.email } } }, status: { notIn: ["ARCHIVED", "DISQUALIFIED"] } } }),
			db.emailThread.count({ where: { contact: { contactRoutes: { some: { type: "EMAIL", normalizedValue: candidate.email } } } } }),
		]);
		if (existingContactRoute || suppressedEmail || suppressedDomain || activeLeadCount > 0 || threadCount > 0) {
			throw new Error(`Safety check failed for ${candidate.key}`);
		}
		checks.push({ key: candidate.key, email: candidate.email, existingContactRoute: false, suppressedEmail: false, suppressedDomain: false, activeLeadCount, threadCount });
		await db.prospectBacklogItem.update({
			where: { id: item.id },
			data: {
				state: "READY",
				lastProcessedAt: new Date(),
				reviewReason: "Weekend preparation: current hook and agency relationship verified from public sources; shared route is staged only; no active Lead or outbound queue created.",
			},
		});
		const common = {
			pilotId: pilot.id,
			itemId: item.id,
			routeQuality: candidate.routeQuality,
			routeVisibility: "SHARED" as const,
			routeConfidence: "HIGH",
			researchSummary: candidate.researchSummary,
			researchConfidence: "HIGH",
			whyNow: candidate.whyNow,
			playerEntryPoint: candidate.playerEntryPoint,
			credibilityAngle: candidate.credibilityAngle,
			ctaApproach: candidate.ctaApproach,
			ctaWhy: candidate.ctaWhy,
			followUpApproach: candidate.followUpApproach,
			language: candidate.language,
			priority: candidate.priority,
			proposedSubject: candidate.subject,
			proposedBody: candidate.body,
			sourceUrls: candidate.sourceUrls,
			status: "PREPARED" as const,
		};
		await db.prospectBacklogPilotItem.upsert({
			where: { pilotId_itemId: { pilotId: pilot.id, itemId: item.id } },
			create: { id: randomUUID(), rank: 1 + candidates.findIndex((entry) => entry.key === candidate.key), ...common },
			update: common,
		});
	}

	const screenCandidates = await db.prospectBacklogItem.findMany({
		where: {
			batchId: batch.id,
			entityType: "PERSON",
			state: "NOT_REVIEWED",
			matchStatus: "NONE",
			normalizedEmail: { not: null },
		},
		orderBy: { canonicalKey: "asc" },
		take: 100,
		select: { id: true, canonicalKey: true },
	});
	const screenReason = "Weekend route screen: email route is staged, but no current player/event hook and agency relationship were independently verified in this pass; enrich before drafting; no active Lead created.";
	for (const item of screenCandidates) {
		await db.prospectBacklogItem.update({
			where: { id: item.id },
			data: { state: "NEEDS_ENRICHMENT", lastProcessedAt: new Date(), nextReviewAt: new Date(Date.now() + 48 * 60 * 60 * 1000), reviewReason: screenReason },
		});
	}

	console.log(JSON.stringify({
		batchId: batch.id,
		pilotId: pilot.id,
		preparedDrafts: candidates.length,
		activeLeadsCreated: 0,
		emailsQueued: 0,
		screenedForEnrichment: screenCandidates.length,
		checks,
		languages: [...new Set(candidates.map((candidate) => candidate.language))],
	}, null, 2));
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
	});
