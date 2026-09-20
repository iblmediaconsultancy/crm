import { randomUUID } from "node:crypto";
import {
	assertPreparedPlayerAllowed,
	classifyProspectBacklogRoute,
	db,
	findProtectedPlayerMatches,
	validatePreparedOutreach,
} from "../packages/db/src/index";

const filename = "IBL_Football_CRM_Master_Deduplicated_Expanded(1).xlsx";
const runLabel = "Deep enrichment pass 2026-09-20";
const pilotName = "Deep enrichment READY 2026-09-20";
const senderSignature =
	"Kind regards,\n\nIhsan | Founder, IBL Media Consultancy\niblmedia.com\nWhatsApp: +31 6 27833383";

type Candidate = {
	key: string;
	email: string;
	language: string;
	mailboxType: "PERSONAL" | "ROLE" | "GENERAL" | "UNKNOWN";
	hookType:
		| "CURRENT_EVENT"
		| "MEDIA_GAP"
		| "FIRST_TEAM_BREAKTHROUGH"
		| "INTERNATIONAL_VISIBILITY"
		| "EMERGING_TALENT"
		| "NEW_SEASON_ROLE_MARKET"
		| "ROSTER_MEDIA_GAP"
		| "EXISTING_RELATIONSHIP"
		| "OTHER_SPECIFIC_OPPORTUNITY";
	routeQuality: string;
	researchSummary: string;
	whyNow: string;
	playerEntryPoint: string;
	credibilityAngle: string;
	ctaApproach: string;
	ctaWhy: string;
	followUpApproach: string;
	priority: "NORMAL" | "HIGH";
	commercialScore: number;
	tier: "A" | "B" | "C";
	subject: string;
	body: string;
	sourceUrls: string[];
};

const deepCandidates: Candidate[] = [
	{
		key: "AGT-0028",
		email: "sales@epicsports.football",
		language: "English",
		mailboxType: "ROLE",
		hookType: "CURRENT_EVENT",
		routeQuality:
			"Published Epic Sports sales route linked to the founder-led agency; role mailbox and CONTACT_ONCE required",
		researchSummary:
			"Epic Sports identifies Ali Barat as founder and publishes a high-level European roster. Independent agency coverage reports Noa Lang joining Epic in May 2026, creating a current agency and player-media moment. The route is a role mailbox, not a verified private address.",
		whyNow:
			"Noa Lang joining Epic is a current agency moment with a clear public-facing story around a recognised Dutch international. It gives Epic a specific reason to discuss how a new player chapter is handled while keeping the wider roster open.",
		playerEntryPoint:
			"Noa Lang is the public hook; ask whether he or another Epic player is the more relevant starting point.",
		credibilityAngle:
			"IBL can support the practical media layer around a high-profile move: consistent social content, matchday storytelling and account management.",
		ctaApproach:
			"Ask who handles Lang's day-to-day media and whether another Epic player would be a better first conversation.",
		ctaWhy:
			"The route is a team mailbox, so the message makes internal routing easy without pretending to know the individual owner.",
		followUpApproach:
			"Follow-up one asks for the correct player-media contact; follow-up two offers a short overview and parks the role route.",
		priority: "HIGH",
		commercialScore: 10,
		tier: "A",
		subject: "Noa Lang's new Epic chapter",
		body:
			"Hi Epic Sports team,\n\nNoa Lang joining Epic is a good moment to think about how the media around a new agency chapter is handled, especially for a player with an established international profile.\n\nIBL helps players keep the practical side consistent around important moments — content, Stories and the account work that keeps the public story moving. Is Noa already covered day to day, or would another Epic player be a better place to start?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://www.epicsports.football/ali-barat",
			"https://www.footballagencies.com/news/ali-barats-epic-sports-add-noa-lang-to-growing-elite-roster/",
			"https://www.footballagencies.com/football-agency/epic-sports-agency-by-ali-barat/",
		],
	},
	{
		key: "AGT-0094",
		email: "info@triplessport.com",
		language: "English",
		mailboxType: "GENERAL",
		hookType: "CURRENT_EVENT",
		routeQuality:
			"Published Triple S general inbox linked to multiple agency decision-makers; CONTACT_ONCE enforced",
		researchSummary:
			"Triple S publishes a current talent roster including Baba Adeeko. Rochdale announced Adeeko's move from Wigan on 14 August 2026 after almost 100 League One appearances. The route is the agency inbox and must be addressed to the team.",
		whyNow:
			"Baba Adeeko's move to Rochdale is a clear new-club moment for a young player with a substantial League One background. It creates a practical reason to discuss how his public story starts at a new club without making the email dependent on him alone.",
		playerEntryPoint:
			"Baba Adeeko is the current hook; ask whether his media is already supported or whether another Triple S player is more relevant.",
		credibilityAngle:
			"IBL can help keep matchday content, Stories and personal-brand work consistent while a player settles into a new club.",
		ctaApproach:
			"Ask who looks after Adeeko's media or whether the team would point to another player where the need is clearer.",
		ctaWhy:
			"The general inbox requires a routing-friendly question rather than a personal salutation.",
		followUpApproach:
			"Follow-up one asks for the relevant media contact; follow-up two briefly explains the type of support and then parks the route.",
		priority: "HIGH",
		commercialScore: 9,
		tier: "A",
		subject: "Baba Adeeko's move to Rochdale",
		body:
			"Hi Triple S team,\n\nBaba Adeeko's move to Rochdale is a good point to think about how the next part of his story is presented, especially after the number of League One games he has already played.\n\nIBL supports players with the content and account work around important career moments — matchdays, Stories and the personal side of the football. Does Baba already have that covered, or is another Triple S player a better place to start?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://triplessport.com/talent/",
			"https://rochdaleafc.co.uk/adeeko-arrives-at-dale/",
		],
	},
	{
		key: "AGT-0285",
		email: "info@gf-management.nl",
		language: "English",
		mailboxType: "GENERAL",
		hookType: "NEW_SEASON_ROLE_MARKET",
		routeQuality:
			"Published GFM general inbox and team route; CONTACT_ONCE protects the shared agency mailbox across its linked agents",
		researchSummary:
			"GFM's official team page identifies Johan Wins and its media page highlights Marius Broholm. Lille announced Broholm's loan to FC Utrecht through the end of 2026/27 on 20 August 2026. The route is the agency inbox.",
		whyNow:
			"Marius Broholm's move to FC Utrecht is a very current Netherlands-facing club change for a young international prospect. It gives GFM a natural reason to discuss the media around that transition while leaving room for another roster player.",
		playerEntryPoint:
			"Marius Broholm is the public hook; ask whether he or another GFM player is the better starting point.",
		credibilityAngle:
			"IBL understands the day-to-day content needed when a young player enters a new league and market.",
		ctaApproach:
			"Ask how Broholm's media is currently handled in Utrecht, or which other GFM player the team would rather discuss.",
		ctaWhy:
			"The agency route is shared, so the question invites the right internal owner into the conversation.",
		followUpApproach:
			"Follow-up one asks for the person responsible for player media; follow-up two offers a concise overview and then parks the inbox.",
		priority: "HIGH",
		commercialScore: 9,
		tier: "A",
		subject: "Marius Broholm at FC Utrecht",
		body:
			"Hi GFM team,\n\nMarius Broholm's move to FC Utrecht is a timely new setting for a young international player, and a natural moment to make sure the media around the move keeps pace with the football.\n\nWe already manage media for players across Premier League, international and emerging-talent environments. How is Marius's day-to-day media currently handled, or would another GFM player be more relevant to discuss?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://globalfootballmanagement.com/team/",
			"https://globalfootballmanagement.com/en/media/",
			"https://www.losc.fr/en/node/19337",
		],
	},
	{
		key: "AGT-0102",
		email: "contact@interlexsport.com",
		language: "English",
		mailboxType: "GENERAL",
		hookType: "EMERGING_TALENT",
		routeQuality:
			"Published InterLex general inbox with agency and media service evidence; CONTACT_ONCE enforced",
		researchSummary:
			"InterLex's official site describes career development from academy to first team and includes media and commercial support. Current agency listings identify a multi-market roster including Ameen Al-Dakhil, Hamidou Kante and Ali Turap Bülbül. The route is the published agency inbox.",
		whyNow:
			"InterLex has a visible group of young players moving across markets, including Hamidou Kante's current Slavia Prague pathway. That creates a useful reason to discuss practical media support around emerging players without assuming which client needs it most.",
		playerEntryPoint:
			"Hamidou Kante is the current entry point; ask whether he or another emerging InterLex player is more relevant.",
		credibilityAngle:
			"IBL works in the space between emerging talent, international visibility and consistent personal-brand execution.",
		ctaApproach:
			"Ask whether Kante already has dedicated media support or whether the InterLex team would point to another player.",
		ctaWhy:
			"The general inbox makes a team-level routing question more appropriate than naming a specific agent.",
		followUpApproach:
			"Follow-up one asks who owns player media at InterLex; follow-up two gives a short practical overview and parks the route.",
		priority: "HIGH",
		commercialScore: 9,
		tier: "A",
		subject: "Hamidou Kante's next step",
		body:
			"Hi InterLex team,\n\nHamidou Kante's move into a new European setting is the kind of point where a young player's public profile can start moving quickly. I wondered how you currently handle the media side for him and the wider emerging group around him.\n\nIBL supports players with the practical work around that growth — matchday content, social accounts and the personal brand between matches. Is Hamidou already covered, or is another InterLex player a better fit for a first conversation?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://interlexsport.com/",
			"https://profile.transferroom.com/agency-profile/Interlex%20Sport",
		],
	},
	{
		key: "AGT-0435",
		email: "info@emsports.hu",
		language: "English",
		mailboxType: "GENERAL",
		hookType: "EMERGING_TALENT",
		routeQuality:
			"Published EM Sports general inbox linked to Mátyás Esterházy and the agency; CONTACT_ONCE enforced",
		researchSummary:
			"EM Sports' official roster shows Viktor Vitályos moving to Sparta Prague and Bence Várkonyi moving to Qarabağ in July 2026. The agency also presents itself as a full-service talent and career-management business. The route is the agency inbox.",
		whyNow:
			"Viktor Vitályos's move to Sparta Prague is a current step for a young Hungarian defender entering a larger public stage. It gives EM Sports a specific reason to discuss how the media layer is handled around that move and the wider next-generation roster.",
		playerEntryPoint:
			"Viktor Vitályos is the current hook; ask whether he or another EM Sports player is more relevant.",
		credibilityAngle:
			"IBL can support the content rhythm and personal-brand layer around a young player moving into a more visible international environment.",
		ctaApproach:
			"Ask whether Viktor has dedicated media support at Sparta or whether another player is more useful to discuss.",
		ctaWhy:
			"The route is general and the roster is youth-oriented, so the CTA keeps the entry point flexible.",
		followUpApproach:
			"Follow-up one asks for the relevant media contact; follow-up two offers a concise example of the work and then parks the shared inbox.",
		priority: "HIGH",
		commercialScore: 8,
		tier: "B",
		subject: "Viktor Vitályos at Sparta Prague",
		body:
			"Hi EM Sports team,\n\nViktor Vitályos's move to Sparta Prague is a meaningful next step for a young player, and a good moment to think about how the media around that move grows with him.\n\nIBL helps players keep the public side of their careers consistent around important moments — matchday content, Stories and the work between matches. Does Viktor already have that support, or is another EM Sports player more relevant to discuss?\n\n" +
			senderSignature,
		sourceUrls: ["https://emsports.hu/"],
	},
	{
		key: "AGT-0620",
		email: "info@tenetfootball.com",
		language: "English",
		mailboxType: "GENERAL",
		hookType: "CURRENT_EVENT",
		routeQuality:
			"Published Tenet Football general inbox and current transfer page; CONTACT_ONCE enforced",
		researchSummary:
			"Tenet's official site identifies Yilmaz Sanli as founding executive director and lists current transfer activity including Deniz Undav's move to VfB Stuttgart. Its about page explicitly includes media and advertising within player management. The route is the agency inbox.",
		whyNow:
			"Deniz Undav's move to Stuttgart is a high-visibility club and international moment for a Tenet player. It creates a specific reason to discuss keeping the media around that change coherent while leaving the wider roster open.",
		playerEntryPoint:
			"Deniz Undav is the current hook; ask whether he or another Tenet player is the better entry point.",
		credibilityAngle:
			"IBL's player-media work fits naturally around a senior international entering a new club setting and public cycle.",
		ctaApproach:
			"Ask how Undav's media is currently handled in Stuttgart, or whether another Tenet player is more relevant.",
		ctaWhy:
			"The general route should reach the team that owns media decisions rather than assume a personal owner.",
		followUpApproach:
			"Follow-up one asks for the player-media contact; follow-up two offers a short overview and then parks the route.",
		priority: "HIGH",
		commercialScore: 9,
		tier: "B",
		subject: "Deniz Undav's Stuttgart move",
		body:
			"Hi Tenet team,\n\nDeniz Undav's move to Stuttgart is a strong new setting for a player with international visibility. It also feels like a natural point to make sure the media around the move is handled as carefully as the football.\n\nWe already manage media for players across Premier League, international and emerging-talent environments. How is Deniz's day-to-day media currently handled, or would another Tenet player be more relevant to discuss?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://tenetfootball.com/",
			"https://tenetfootball.com/about/",
		],
	},
	{
		key: "AGT-0495",
		email: "info@fp.agency",
		language: "English",
		mailboxType: "GENERAL",
		hookType: "ROSTER_MEDIA_GAP",
		routeQuality:
			"Published Full Potential general inbox and official player/team pages; CONTACT_ONCE enforced",
		researchSummary:
			"Full Potential publishes a current 2026 squad including Melker Widell at Swansea City and a dedicated creative director and athlete-partnerships function. The agency also presents long- and short-form storytelling through its TALKS platform. The route is the agency inbox.",
		whyNow:
			"Full Potential already thinks seriously about athlete storytelling, and its current roster spans established players and emerging talents such as Melker Widell. That makes a practical conversation about where external player-level media support complements the agency's work more relevant than a generic introduction.",
		playerEntryPoint:
			"Melker Widell is the current roster hook; ask whether he or another player is the better place to explore support.",
		credibilityAngle:
			"IBL can complement an agency's broader storytelling work with day-to-day social, matchday and account execution for selected players.",
		ctaApproach:
			"Ask whether Full Potential handles player accounts centrally or whether a selected player would benefit from dedicated support.",
		ctaWhy:
			"The agency already has creative capability, so the CTA tests for a real gap instead of assuming one.",
		followUpApproach:
			"Follow-up one asks how player-level account work is split; follow-up two offers a short overview only if an actual gap exists.",
		priority: "NORMAL",
		commercialScore: 7,
		tier: "B",
		subject: "Melker Widell's Swansea step",
		body:
			"Hi Full Potential team,\n\nMelker Widell's move to Swansea is a useful example of the kind of new-market moment where a player's public story has to keep pace with the football.\n\nI saw that Full Potential already puts real thought into athlete storytelling. IBL can complement that with the day-to-day work around selected players — matchday content, Stories, captions and account management. Do you handle that centrally, or is there a player where extra support would be useful?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://www.fp.agency/players",
			"https://www.fp.agency/team",
			"https://www.fp.agency/",
		],
	},
	{
		key: "AGT-0405",
		email: "contact@sportcover.co",
		language: "English",
		mailboxType: "GENERAL",
		hookType: "INTERNATIONAL_VISIBILITY",
		routeQuality:
			"Published Sport Cover agency inbox and current roster page; CONTACT_ONCE enforced",
		researchSummary:
			"Sport Cover's official site identifies Meïssa N'Diaye, lists Samson Baidoo at RC Lens and describes dedicated media-related support across a 56-plus-player roster. The route is the agency inbox.",
		whyNow:
			"Samson Baidoo's move into RC Lens gives Sport Cover a current young-player and new-club story to work around. It is a concrete opening for a selective discussion without assuming the agency lacks its own media capability.",
		playerEntryPoint:
			"Samson Baidoo is the current hook; ask whether he or another Sport Cover player is the better entry point.",
		credibilityAngle:
			"IBL can add focused player-level execution around matchdays and career moments when an agency's wider support model needs a dedicated content layer.",
		ctaApproach:
			"Ask whether Baidoo already has dedicated media support at Lens or whether another player would be more relevant.",
		ctaWhy:
			"Sport Cover already highlights media-related support, so the CTA checks for a genuine complement rather than assuming a gap.",
		followUpApproach:
			"Follow-up one asks how player-level content is currently handled; follow-up two offers a brief overview only if a specific need exists.",
		priority: "HIGH",
		commercialScore: 8,
		tier: "B",
		subject: "Samson Baidoo at Lens",
		body:
			"Hi Sport Cover team,\n\nSamson Baidoo's move to Lens is a good new-club moment for a young player, and a natural point to think about how the public side of that step is handled.\n\nI saw that Sport Cover already takes media and image seriously across its roster. IBL can complement that where a player needs hands-on day-to-day support around matchdays, Stories and account management. Is Samson already covered, or is another player more relevant to discuss?\n\n" +
			senderSignature,
		sourceUrls: ["https://www.sportcover.co/"],
	},
	{
		key: "AGT-0004",
		email: "info@proprofil.de",
		language: "English",
		mailboxType: "GENERAL",
		hookType: "CURRENT_EVENT",
		routeQuality:
			"Published PRO Profil general inbox and current agency news page; CONTACT_ONCE enforced",
		researchSummary:
			"PRO Profil publishes current player updates including Lasse Wilhelm's move to ADO Den Haag and Philipp Schulze's Champions League qualifying debut. The agency explicitly mentions public affairs and media advice. The route is the agency inbox.",
		whyNow:
			"Lasse Wilhelm's move to ADO Den Haag creates a current Eredivisie step and a clear public story for PRO Profil's young-player work. It is a specific opening to ask how the media around the move is being handled while leaving room for another player.",
		playerEntryPoint:
			"Lasse Wilhelm is the current hook; ask whether he or another PRO Profil player is more relevant.",
		credibilityAngle:
			"IBL can complement formal representation with practical, consistent player media around a move and the season that follows.",
		ctaApproach:
			"Ask whether Wilhelm already has dedicated media support at ADO or whether another PRO Profil player is a better starting point.",
		ctaWhy:
			"The general mailbox should route the question to the correct player-media owner.",
		followUpApproach:
			"Follow-up one asks who handles media for Wilhelm; follow-up two gives a concise overview and then parks the route.",
		priority: "HIGH",
		commercialScore: 8,
		tier: "B",
		subject: "Lasse Wilhelm's move to ADO",
		body:
			"Hi PRO Profil team,\n\nLasse Wilhelm's move to ADO Den Haag is a clear next step for a young player, and a good moment to think about how the media around that move carries into the new season.\n\nIBL helps players keep the public side of their careers consistent around important moments — matchday content, Stories and the work between matches. Does Lasse already have that support, or is another PRO Profil player more relevant to discuss?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://proprofil.de/news/",
			"https://proprofil.de/en/about-us/",
		],
	},
];

const asObject = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};

const collectUrls = (rawValue: unknown) => {
	const raw = asObject(rawValue);
	const urls = new Set<string>();
	for (const value of Object.values(raw)) {
		if (typeof value !== "string") continue;
		for (const match of value.matchAll(/https?:\/\/[^\s;,]+/gi)) {
			urls.add(match[0].replace(/[).]+$/, ""));
		}
	}
	return [...urls];
};

const screeningScore = (item: {
	agencyName: string | null;
	normalizedEmail: string | null;
	normalizedLinkedInUrl: string | null;
	routes: Array<{
		route: { mailboxType: string; routeUsage: string; type: string };
	}>;
	sourceRecords: Array<{ rawValues: unknown }>;
}) => {
	const raw = asObject(item.sourceRecords[0]?.rawValues);
	const text = JSON.stringify(raw).toLowerCase();
	const route = item.routes.find((link) => link.route.type === "EMAIL")?.route;
	let score = 0;
	if (item.agencyName) score += 3;
	if (item.normalizedEmail) score += 3;
	if (route) score += 3;
	if (route?.mailboxType && route.mailboxType !== "UNKNOWN") score += 2;
	if (route?.routeUsage === "CONTACT_ONCE") score += 1;
	if (item.normalizedLinkedInUrl) score += 2;
	if (
		/verified|official|ready|player-portfolio|decision-maker|agent/.test(text)
	)
		score += 2;
	if (
		/gmail|hotmail|icloud|outlook|yahoo|proton/.test(item.normalizedEmail ?? "")
	)
		score -= 4;
	return score;
};

const safetyCheck = async (email: string) => {
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
		}),
		db.suppressedContact.findUnique({ where: { email } }),
		db.suppressedDomain.findUnique({ where: { domain } }),
		db.lead.count({
			where: {
				contact: {
					contactRoutes: { some: { type: "EMAIL", normalizedValue: email } },
				},
				status: { notIn: ["ARCHIVED", "DISQUALIFIED"] },
			},
		}),
		db.emailThread.count({
			where: {
				contact: {
					contactRoutes: { some: { type: "EMAIL", normalizedValue: email } },
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
};

async function triageBatch(
	_batchId: string,
	items: Awaited<ReturnType<typeof loadItems>>,
) {
	const processedAt = new Date();
	const results = { worked: 0, deferred: 0, protected: 0, routeConflicts: 0 };
	for (const item of items) {
		const routeLink = item.routes.find((link) => link.route.type === "EMAIL");
		const route = routeLink?.route;
		const safety = item.normalizedEmail
			? await safetyCheck(item.normalizedEmail)
			: null;
		const protectedMatches =
			item.entityType === "PLAYER"
				? await findProtectedPlayerMatches(db, [item.displayName])
				: [];
		if (protectedMatches.length > 0) {
			results.protected += 1;
			await db.prospectBacklogEnrichment.create({
				data: {
					id: randomUUID(),
					itemId: item.id,
					runLabel,
					status: "REJECTED",
					tier: "C",
					notes:
						"Protected player identity matched; acquisition preparation is not allowed.",
					missingReason: "DO_NOT_PROSPECT_PLAYER",
					sourceUrls: collectUrls(item.sourceRecords[0]?.rawValues),
					evidence: {
						matchedPlayers: protectedMatches.map((match) => match.displayName),
					},
				},
			});
			await db.prospectBacklogItem.update({
				where: { id: item.id },
				data: {
					state: "SUPPRESSED",
					lastProcessedAt: processedAt,
					lastEnrichedAt: processedAt,
					tier: "C",
					reviewReason: "Protected player policy: do not prospect this player.",
				},
			});
			continue;
		}
		const routeConfidence = route
			? route.mailboxType === "UNKNOWN"
				? "MEDIUM"
				: "HIGH"
			: "LOW";
		const sourceUrls = collectUrls(item.sourceRecords[0]?.rawValues);
		const raw = asObject(item.sourceRecords[0]?.rawValues);
		const rawText = JSON.stringify(raw);
		const researchConfidence =
			sourceUrls.length > 0 && /verified|official|ready/i.test(rawText)
				? "MEDIUM"
				: sourceUrls.length > 0
					? "LOW-MEDIUM"
					: "LOW";
		const commercialPriority =
			item.agencyName && route && screeningScore(item) >= 12
				? "HIGH"
				: "NORMAL";
		const commercialScore =
			item.agencyName && route && screeningScore(item) >= 12 ? 6 : 4;
		const reason =
			safety &&
			(safety.contactRoute ||
				safety.suppressedEmail ||
				safety.suppressedDomain ||
				safety.activeLeadCount > 0 ||
				safety.threadCount > 0)
				? "CRM, suppression, cooldown or existing-thread signal requires manual review before promotion."
				: "Professional route and source provenance reviewed; current player relationship and evidence-backed media hook still need independent confirmation.";
		await db.prospectBacklogEnrichment.create({
			data: {
				id: randomUUID(),
				itemId: item.id,
				runLabel,
				status: "DEFERRED",
				routeConfidence,
				researchConfidence,
				commercialPriority,
				commercialScore,
				tier: "C",
				notes:
					"Deep-enrichment triage completed from staged identity, route and provenance data.",
				missingReason: reason,
				sourceUrls,
				evidence: {
					displayName: item.displayName,
					agencyName: item.agencyName,
					mailboxType: route?.mailboxType ?? "UNKNOWN",
					routeUsage: route?.routeUsage ?? "CONTACT_ONCE",
					crmContactRoute: Boolean(safety?.contactRoute),
					activeLeadCount: safety?.activeLeadCount ?? 0,
					threadCount: safety?.threadCount ?? 0,
				},
			},
		});
		await db.prospectBacklogItem.update({
			where: { id: item.id },
			data: {
				lastProcessedAt: processedAt,
				lastEnrichedAt: processedAt,
				routeConfidence,
				researchConfidence,
				commercialPriority,
				commercialScore,
				tier: "C",
				enrichmentNotes: reason,
				enrichmentEvidence: {
					sourceUrls,
					mailboxType: route?.mailboxType ?? "UNKNOWN",
				},
				nextReviewAt: new Date(processedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
				reviewReason: reason,
			},
		});
		results.worked += 1;
		results.deferred += 1;
		if (
			safety &&
			(safety.contactRoute ||
				safety.suppressedEmail ||
				safety.suppressedDomain ||
				safety.activeLeadCount > 0 ||
				safety.threadCount > 0)
		)
			results.routeConflicts += 1;
	}
	return results;
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

async function prepareCandidate(
	batchId: string,
	pilotId: string,
	candidate: Candidate,
	rank: number,
) {
	const item = await db.prospectBacklogItem.findUnique({
		where: { batchId_canonicalKey: { batchId, canonicalKey: candidate.key } },
		include: { routes: { include: { route: true } } },
	});
	if (item?.state !== "NEEDS_ENRICHMENT")
		return { key: candidate.key, skipped: true };
	const routeLink = item.routes.find(
		(link) =>
			link.route.type === "EMAIL" &&
			link.route.normalizedValue === candidate.email,
	);
	if (!routeLink) throw new Error(`Missing route for ${candidate.key}`);
	const classification = classifyProspectBacklogRoute({
		type: routeLink.route.type,
		value: routeLink.route.value,
		linkedEntityKeys: Array.isArray(routeLink.route.linkedEntityKeys)
			? routeLink.route.linkedEntityKeys.filter(
					(value): value is string => typeof value === "string",
				)
			: [],
		entityNames: [item.displayName],
	});
	if (classification.mailboxType !== candidate.mailboxType)
		throw new Error(`${candidate.key} mailbox classification changed`);
	if (classification.routeUsage !== "CONTACT_ONCE")
		throw new Error(`${candidate.key} is not CONTACT_ONCE`);
	const quality = validatePreparedOutreach({
		language: candidate.language,
		hookType: candidate.hookType,
		whyNow: candidate.whyNow,
		researchSummary: candidate.researchSummary,
		sourceUrls: candidate.sourceUrls,
	});
	if (!quality.valid) throw new Error(`${candidate.key}: ${quality.reason}`);
	await assertPreparedPlayerAllowed(db, [candidate.playerEntryPoint]);
	const safety = await safetyCheck(candidate.email);
	if (
		safety.contactRoute ||
		safety.suppressedEmail ||
		safety.suppressedDomain ||
		safety.activeLeadCount > 0 ||
		safety.threadCount > 0
	)
		return { key: candidate.key, skipped: true, reason: "safety-conflict" };
	const now = new Date();
	await db.prospectBacklogEnrichment.create({
		data: {
			id: randomUUID(),
			itemId: item.id,
			runLabel,
			status: "COMPLETED",
			routeConfidence: candidate.mailboxType === "UNKNOWN" ? "MEDIUM" : "HIGH",
			researchConfidence: "HIGH",
			commercialPriority: candidate.priority,
			commercialScore: candidate.commercialScore,
			tier: candidate.tier,
			playerEntryPoint: candidate.playerEntryPoint,
			hookType: candidate.hookType,
			whyNow: candidate.whyNow,
			notes: candidate.researchSummary,
			sourceUrls: candidate.sourceUrls,
			evidence: {
				agency: item.agencyName,
				route: candidate.email,
				mailboxType: classification.mailboxType,
			},
		},
	});
	await db.prospectBacklogItem.update({
		where: { id: item.id },
		data: {
			state: "READY",
			lastProcessedAt: now,
			lastEnrichedAt: now,
			routeConfidence: candidate.mailboxType === "UNKNOWN" ? "MEDIUM" : "HIGH",
			researchConfidence: "HIGH",
			commercialPriority: candidate.priority,
			commercialScore: candidate.commercialScore,
			tier: candidate.tier,
			enrichmentNotes: candidate.researchSummary,
			enrichmentEvidence: {
				sourceUrls: candidate.sourceUrls,
				playerEntryPoint: candidate.playerEntryPoint,
			},
			reviewReason:
				"Deep enrichment completed from current agency, player and route sources; staged only; no active Lead or outbound queue created.",
		},
	});
	await db.prospectBacklogPilotItem.upsert({
		where: { pilotId_itemId: { pilotId, itemId: item.id } },
		create: {
			id: randomUUID(),
			pilotId,
			itemId: item.id,
			routeId: routeLink.route.id,
			rank,
			routeQuality: candidate.routeQuality,
			routeVisibility: "SHARED",
			mailboxType: classification.mailboxType,
			mailboxTypeEvidence: classification.mailboxTypeEvidence,
			routeUsage: classification.routeUsage,
			routeConfidence: candidate.mailboxType === "UNKNOWN" ? "MEDIUM" : "HIGH",
			researchSummary: candidate.researchSummary,
			researchConfidence: "HIGH",
			hookType: candidate.hookType,
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
			status: "PREPARED",
		},
		update: {
			routeId: routeLink.route.id,
			rank,
			routeQuality: candidate.routeQuality,
			mailboxType: classification.mailboxType,
			mailboxTypeEvidence: classification.mailboxTypeEvidence,
			routeUsage: classification.routeUsage,
			routeConfidence: candidate.mailboxType === "UNKNOWN" ? "MEDIUM" : "HIGH",
			researchSummary: candidate.researchSummary,
			researchConfidence: "HIGH",
			hookType: candidate.hookType,
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
			status: "PREPARED",
		},
	});
	return { key: candidate.key, skipped: false };
}

async function rankReady(batchId: string) {
	const items = await db.prospectBacklogItem.findMany({
		where: { batchId, state: "READY" },
		include: { pilotItems: { orderBy: { rank: "asc" }, take: 1 } },
	});
	const confidenceScore = (value: string | null) =>
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
			const candidate = deepCandidates.find(
				(entry) => entry.key === item.canonicalKey,
			);
			const routeConfidence =
				item.routeConfidence ?? pilot?.routeConfidence ?? null;
			const researchConfidence =
				item.researchConfidence ?? pilot?.researchConfidence ?? null;
			const commercialPriority =
				item.commercialPriority ??
				candidate?.priority ??
				pilot?.priority ??
				"NORMAL";
			const commercialScore =
				candidate?.commercialScore ??
				item.commercialScore ??
				(commercialPriority === "HIGH" ? 6 : 4);
			const score =
				confidenceScore(routeConfidence) +
				confidenceScore(researchConfidence) +
				commercialScore / 2 +
				(pilot?.mailboxType === "PERSONAL"
					? 2
					: pilot?.mailboxType === "UNKNOWN"
						? 0
						: 1) +
				(pilot?.hookType ? 1 : 0);
			return {
				item,
				pilot,
				score,
				routeConfidence,
				researchConfidence,
				commercialPriority,
				commercialScore,
			};
		})
		.sort(
			(a, b) =>
				b.score - a.score ||
				a.item.canonicalKey.localeCompare(b.item.canonicalKey),
		);
	for (const [index, entry] of ranked.entries()) {
		const tier = index < 5 ? "A" : index < 15 ? "B" : "C";
		await db.prospectBacklogItem.update({
			where: { id: entry.item.id },
			data: {
				tier,
				routeConfidence: entry.routeConfidence,
				researchConfidence: entry.researchConfidence,
				commercialPriority: entry.commercialPriority,
				commercialScore: entry.commercialScore,
			},
		});
	}
	return ranked.map((entry, index) => ({
		key: entry.item.canonicalKey,
		name: entry.item.displayName,
		score: entry.score,
		tier: index < 5 ? "A" : index < 15 ? "B" : "C",
		routeConfidence: entry.routeConfidence,
		researchConfidence: entry.researchConfidence,
		commercialPriority: entry.commercialPriority,
		commercialScore: entry.commercialScore,
	}));
}

async function main() {
	if (process.env.ATLAS_LIVE_OUTREACH_ENABLED !== "false")
		throw new Error("ATLAS_LIVE_OUTREACH_ENABLED must be explicitly false");
	const batch = await db.prospectSourceBatch.findFirst({
		where: { filename },
		orderBy: { importedAt: "desc" },
	});
	if (!batch) throw new Error("Workbook source batch not found");
	const all = await loadItems(batch.id);
	const rankOnly = process.argv.includes("--rank-only");
	const triageResults = {
		worked: 0,
		deferred: 0,
		protected: 0,
		routeConflicts: 0,
	};
	let selectedCount = 0;
	const prepared: Array<{ key: string; skipped: boolean; reason?: string }> =
		[];
	if (!rankOnly) {
		const ranked = all
			.map((item) => ({ item, score: screeningScore(item) }))
			.sort(
				(a, b) =>
					b.score - a.score ||
					a.item.canonicalKey.localeCompare(b.item.canonicalKey),
			);
		const selected = ranked.slice(0, 200).map((entry) => entry.item);
		selectedCount = selected.length;
		for (let index = 0; index < selected.length; index += 50) {
			const result = await triageBatch(
				batch.id,
				selected.slice(index, index + 50),
			);
			triageResults.worked += result.worked;
			triageResults.deferred += result.deferred;
			triageResults.protected += result.protected;
			triageResults.routeConflicts += result.routeConflicts;
		}
		const pilot = await db.prospectBacklogPilot.upsert({
			where: { batchId_name: { batchId: batch.id, name: pilotName } },
			create: {
				id: randomUUID(),
				batchId: batch.id,
				name: pilotName,
				status: "PREPARED",
			},
			update: { status: "PREPARED", preparedAt: new Date() },
		});
		for (const [index, candidate] of deepCandidates.entries())
			prepared.push(
				await prepareCandidate(batch.id, pilot.id, candidate, index + 1),
			);
	}
	const readyRanking = await rankReady(batch.id);
	const stateRows = await db.prospectBacklogItem.groupBy({
		by: ["state"],
		where: { batchId: batch.id },
		_count: { _all: true },
	});
	console.log(
		JSON.stringify(
			{
				runLabel,
				screened: all.length,
				selected: selectedCount,
				triageResults,
				deepCandidates: rankOnly ? 0 : deepCandidates.length,
				prepared,
				readyTotal: readyRanking.length,
				tierCounts: {
					A: readyRanking.filter((row) => row.tier === "A").length,
					B: readyRanking.filter((row) => row.tier === "B").length,
					C: readyRanking.filter((row) => row.tier === "C").length,
				},
				states: stateRows.map((row) => ({
					state: row.state,
					count: row._count._all,
				})),
				topReady: readyRanking.slice(0, 20),
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
