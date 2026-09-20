import { randomUUID } from "node:crypto";
import {
	assertPreparedPlayerAllowed,
	classifyProspectBacklogRoute,
	db,
	findProtectedPlayerMatches,
	validatePreparedOutreach,
} from "../packages/db/src/index";

const filename = "IBL_Football_CRM_Master_Deduplicated_Expanded(1).xlsx";
const pilotName = "Extended weekend preparation 2026-09-20";
const supportedLanguages = new Set(["English", "Dutch", "Turkish"]);
const freeMailDomains = new Set([
	"gmail.com",
	"googlemail.com",
	"hotmail.com",
	"icloud.com",
	"live.com",
	"outlook.com",
	"proton.me",
	"protonmail.com",
	"wanadoo.fr",
	"yahoo.com",
	"yahoo.co.uk",
]);
const senderSignature =
	"Kind regards,\n\nIhsan | Founder, IBL Media Consultancy\niblmedia.com\nWhatsApp: +31 6 27833383";

const deepCandidates = [
	{
		key: "AGT-0011",
		email: "contact@goalmanagement.global",
		language: "English",
		mailboxType: "GENERAL" as const,
		hookType: "CURRENT_EVENT" as const,
		routeQuality:
			"Published Goal Management general inbox; route is linked to Albert Botines and other agency records; CONTACT_ONCE required",
		researchSummary:
			"Goal Management's current official site lists Seydou Fall's move from Granada CF to Real Jaén through 2028 and shows the agency's current professional roster and communications function. The route is the published agency inbox, not a verified private mailbox for Albert Botines. Confidence: high.",
		whyNow:
			"Seydou Fall's move to Real Jaén through 2028 is a current change in a young player's career story, and the agency is presenting that work alongside a roster that spans established and emerging players. That gives Goal Management a specific opening to discuss how the media layer is handled around new club chapters without making the conversation depend on Fall alone.",
		playerEntryPoint:
			"Seydou Fall is the current public hook; ask whether he or another Goal Management player is the better entry point.",
		credibilityAngle:
			"IBL can support the practical media work around a new club chapter: matchday content, Stories and consistent account management.",
		ctaApproach:
			"Ask whether Fall already has dedicated media support at Real Jaén or whether another player is more relevant.",
		ctaWhy:
			"The route is general, so the message asks the team to route the conversation to the right player contact.",
		followUpApproach:
			"Follow-up one asks who handles the player's day-to-day media; follow-up two offers a brief overview and then parks the shared route.",
		priority: "HIGH" as const,
		subject: "Seydou Fall's next step",
		body:
			"Hi Goal Management team,\n\nSeydou Fall's move from Granada to Real Jaén through 2028 is a good moment to think about how the next part of his story is presented, especially as the season gets moving.\n\nIBL helps players keep the media side consistent around important career moments — the matchday content, Stories and account work that sit around the football. Does Seydou already have that support, or is another Goal Management player a better place to start?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://www.goalmanagement.global/",
			"https://www.goalmanagement.global/players",
			"https://www.goalmanagement.global/team",
		],
	},
	{
		key: "AGT-0030",
		email: "info@eliteconsulting.dk",
		language: "English",
		mailboxType: "GENERAL" as const,
		hookType: "NEW_SEASON_ROLE_MARKET" as const,
		routeQuality:
			"Published Elite Consulting general inbox; route is linked to Allan Bak Jensen and the agency; CONTACT_ONCE required",
		researchSummary:
			"Elite Consulting's current official player page lists Victor Froholdt at FC Porto and Anders Dreyer at San Diego FC, and identifies Allan Bak as part of the agency team. Liga Portugal's current player page also lists Froholdt at FC Porto. The route is the agency inbox, not a verified personal address. Confidence: high.",
		whyNow:
			"Victor Froholdt's move into FC Porto gives Elite Consulting a clear high-visibility player story at the start of a new season and market. It is a useful entry point for a wider conversation about keeping the public-facing side of a young international player's career coherent, while leaving room for another Elite player to be the better fit.",
		playerEntryPoint:
			"Victor Froholdt is the current public hook; ask whether he or another Elite Consulting player is more relevant for a first conversation.",
		credibilityAngle:
			"IBL already manages media for players across Premier League, international and emerging-talent environments, which is relevant to an international move with a growing public profile.",
		ctaApproach:
			"Ask how Froholdt's media is currently handled at Porto, or whether another Elite player would be a more useful starting point.",
		ctaWhy:
			"The shared inbox requires an internal routing question rather than assuming Allan owns the player's media.",
		followUpApproach:
			"Follow-up one asks who owns player media at Elite; follow-up two briefly explains the type of matchday and account support IBL provides before parking the route.",
		priority: "HIGH" as const,
		subject: "Victor Froholdt at Porto",
		body:
			"Hi Elite Consulting team,\n\nVictor Froholdt's move into FC Porto gives him a very visible new setting this season. It feels like a natural point to make sure the media around that step is as considered as the football itself.\n\nWe already manage media for players across Premier League, international and emerging-talent environments. How is Victor's day-to-day media currently handled, or would another Elite player be a better person to discuss?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://eliteconsulting.dk/",
			"https://eliteconsulting.dk/how-we-work/",
			"https://www.ligaportugal.pt/player/84098/froholdt/20252026/157",
		],
	},
	{
		key: "AGT-0043",
		email: "info@worldinmotion.com",
		language: "English",
		mailboxType: "GENERAL" as const,
		hookType: "INTERNATIONAL_VISIBILITY" as const,
		routeQuality:
			"Published World in Motion general inbox; route is linked to Andy Evans and the agency; CONTACT_ONCE required",
		researchSummary:
			"World in Motion's current football pages identify Andy Evans as CEO and publish the agency inbox. The current agency site highlights Mandela Keita's return to the Belgium senior squad and reports 61 completed transfers in the summer 2026 window. Confidence: high.",
		whyNow:
			"Mandela Keita's return to the Belgium senior squad gives World in Motion a timely international-visibility moment to work around. It creates a specific reason to discuss content and personal-brand support while keeping the conversation open to another player in a large roster.",
		playerEntryPoint:
			"Mandela Keita is the current public hook; ask the World in Motion team whether he or another player is the right entry point.",
		credibilityAngle:
			"IBL's experience across international and emerging-talent environments fits a moment when a player's club work and national-team visibility need to sit together naturally.",
		ctaApproach:
			"Ask who handles Keita's media day to day, or whether another World in Motion player should be the first conversation.",
		ctaWhy:
			"The route is general and the agency has an in-house media function, so the CTA asks for the correct internal owner.",
		followUpApproach:
			"Follow-up one asks for the media contact on the football side; follow-up two offers a concise overview for the relevant player and then parks the route.",
		priority: "HIGH" as const,
		subject: "Mandela Keita's Belgium return",
		body:
			"Hi World in Motion team,\n\nMandela Keita's return to the Belgium senior squad is a strong moment for his public profile, especially with the club and international sides now telling the story together.\n\nIBL supports players around those moments with the practical media work — matchday content, Stories and keeping the account consistent as attention moves between club and country. Who handles Mandela's media day to day, or is another World in Motion player a better place to start?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://www.worldinmotion.com/",
			"https://www.worldinmotion.com/team",
			"https://www.worldinmotion.com/football",
		],
	},
	{
		key: "AGT-0034",
		email: "mrodrigues@sferico.pt",
		language: "English",
		mailboxType: "UNKNOWN" as const,
		hookType: "CURRENT_EVENT" as const,
		routeQuality:
			"Professional Sferico route from the staged workbook; local part is not verified as Andreas Goller's personal mailbox, so address the Sferico team; CONTACT_ONCE required",
		researchSummary:
			"Sferico's current official transfer page identifies Geovany Quenda's move from Sporting CP to Chelsea and presents the agency's current roster and market coverage. The staged route is on the Sferico domain but is not verified as a private route for Andreas Goller. Confidence: medium-high.",
		whyNow:
			"Geovany Quenda's move into Chelsea is a very visible new-market moment for Sferico. That makes the agency a reasonable candidate for a practical conversation about the media side of career transitions, while keeping the opportunity open to another Sferico player rather than assuming Quenda is the only relevant contact.",
		playerEntryPoint:
			"Geovany Quenda is the current public hook; address the Sferico team and ask whether he or another player is the right internal entry point.",
		credibilityAngle:
			"IBL works around the media layer of important moves and international visibility, with practical support rather than a claim of access to the club or player.",
		ctaApproach:
			"Ask whether the Sferico team already has media support around Quenda's move, or whether another player is more relevant.",
		ctaWhy:
			"The route ownership is uncertain, so the message avoids addressing Andreas personally and makes internal routing easy.",
		followUpApproach:
			"Follow-up one asks who owns media for the Chelsea move; follow-up two offers a short example of the work IBL handles and then parks the route.",
		priority: "NORMAL" as const,
		subject: "Geovany Quenda's Chelsea move",
		body:
			"Hi Sferico team,\n\nGeovany Quenda's move from Sporting into Chelsea is a significant new-market step and a natural point to think about how the media around that transition is handled.\n\nIBL supports players with the practical side of that work — content around career moments, matchdays and the day-to-day account management that keeps a profile coherent. Does Geovany already have dedicated support, or is another Sferico player a better place to start?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://sferico.net/transfers/",
			"https://sferico.net/clients/",
			"https://www.chelseafc.com/en/news/article/geovany-quenda-joins-chelsea",
		],
	},
	{
		key: "AGT-0042",
		email: "media@niagarasportsteam.com",
		language: "English",
		mailboxType: "ROLE" as const,
		hookType: "NEW_SEASON_ROLE_MARKET" as const,
		routeQuality:
			"Published Niagara Sports Team media route; role mailbox, not a private Andy Bara route; CONTACT_ONCE required",
		researchSummary:
			"Niagara Sports Team's official site lists Joan García among its players and explicitly publishes media@niagarasportsteam.com for contact. LaLiga's current 2026/27 player page lists Joan García at FC Barcelona with six appearances and 495 minutes. Confidence: high.",
		whyNow:
			"Joan García is now carrying a visible Barcelona role in the 2026/27 season, which gives Niagara's media team a specific current moment to consider. The contact is a media role route, so the message is framed for the team and leaves the wider roster open.",
		playerEntryPoint:
			"Joan García is the current public hook; ask the Niagara media team whether he or another player is the right first conversation.",
		credibilityAngle:
			"IBL can add practical matchday and account support around a high-visibility club move without implying a relationship with Barcelona or the player.",
		ctaApproach:
			"Ask whether Joan already has dedicated media support at Barcelona, or whether another Niagara player would be more relevant.",
		ctaWhy:
			"The route is explicitly a media role inbox, so addressing the team is accurate and makes internal routing straightforward.",
		followUpApproach:
			"Follow-up one asks who on the media team owns Joan's account work; follow-up two offers a short overview and then parks the route.",
		priority: "HIGH" as const,
		subject: "Joan García's Barcelona season",
		body:
			"Hi Niagara media team,\n\nJoan García is now carrying a visible Barcelona role at the start of the 2026/27 season. That feels like a useful moment to look at how the media around the move and the weekly match rhythm is being handled.\n\nIBL helps players with the practical layer around that visibility — matchday content, Stories and keeping the account work consistent. Does Joan already have dedicated media support, or would another Niagara player be more relevant for an initial conversation?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://www.niagarasportsteam.com/",
			"https://www.niagarasportsteam.com/players/",
			"https://www.laliga.com/en-US/player/j-garcia",
		],
	},
	{
		key: "AGT-0014",
		email: "info@footfeel.com",
		language: "English",
		mailboxType: "GENERAL" as const,
		hookType: "ROSTER_MEDIA_GAP" as const,
		routeQuality:
			"Published Footfeel general inbox; route is linked to Alejandro Camaño and the agency; CONTACT_ONCE required",
		researchSummary:
			"Footfeel's current official site lists a professional roster including Achraf Hakimi, Lautaro Martínez, Mario Gila, Borja Mayoral and Said El Mala, and explicitly offers brand, marketing, content production, social media and PR/media services. A separate March 2026 report says Footfeel's representation of Said El Mala ended, so the draft does not use El Mala as a contact hook. Confidence: medium-high.",
		whyNow:
			"Footfeel already presents content production, social media and PR/media as part of its player service mix, while also managing a roster with very different levels of public visibility. That creates a specific conversation about where an external media team could complement the agency's work, without relying on a player relationship that may have changed.",
		playerEntryPoint:
			"The roster mix and the agency's published media services are the entry point; ask which current player has the clearest need rather than naming Said El Mala.",
		credibilityAngle:
			"IBL can be positioned as an execution partner for day-to-day account management and matchday content where the agency wants extra capacity, not as a replacement for Footfeel's representation work.",
		ctaApproach:
			"Ask whether Footfeel ever brings in outside support for a player's day-to-day media, or whether there is a current player where an overview would be useful.",
		ctaWhy:
			"The route is a general inbox and the agency already offers media services, so the CTA tests for a genuine capacity gap rather than assuming one.",
		followUpApproach:
			"Follow-up one asks whether the agency handles all account execution in-house; follow-up two offers a short overview of IBL's execution support and then parks the route.",
		priority: "NORMAL" as const,
		subject: "Footfeel's player-media support",
		body:
			"Hi Footfeel team,\n\nI noticed Footfeel already covers brand, marketing, content production and PR/media alongside player representation. With a roster that runs from established international players to emerging talent, I wondered whether there are moments where extra day-to-day media capacity would be useful.\n\nIBL handles the practical account side around career moments — matchday content, Stories, captions and keeping the channels moving consistently. Do you ever bring in outside support for that work, or is there a current Footfeel player where a short overview would be useful?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://footfeel.com/",
			"https://footfeel.com/",
			"https://www.footballagencies.com/football-agency/footfeel-ism-international-sports-management/",
		],
	},
	{
		key: "AGT-0169",
		email: "info@bestofyou.es",
		language: "English",
		mailboxType: "GENERAL" as const,
		hookType: "CURRENT_EVENT" as const,
		routeQuality:
			"Published Best of You general inbox; route is linked to Esteban Granero and the agency; CONTACT_ONCE required",
		researchSummary:
			"Best of You announced on 14 September 2026 that Premier League player Manuel Ángel joined its family. Real Madrid's official statement records his transfer to Fulham on 1 September 2026 and his first-team debut before the move. The route is the published agency inbox, not a verified personal mailbox for Esteban Granero. Confidence: high.",
		whyNow:
			"Manuel Ángel's move from Real Madrid to Fulham and his recent arrival at Best of You create a very current new-club and new-agency moment. It is a specific opening to ask how the media side is being supported while leaving room for another Best of You player to be more relevant.",
		playerEntryPoint:
			"Manuel Ángel is the current public hook; ask whether he or another Best of You player is the right internal entry point.",
		credibilityAngle:
			"IBL can help with the practical content and account work around a young player's move into a Premier League environment without claiming access to Fulham or the player.",
		ctaApproach:
			"Ask whether Manuel already has dedicated media support for the Fulham move, or whether another Best of You player is a better starting point.",
		ctaWhy:
			"The route is general and the agency has a broad roster, so the CTA asks for the right internal path instead of assuming Esteban owns the player.",
		followUpApproach:
			"Follow-up one asks who handles Manuel's day-to-day media; follow-up two offers a short overview and then parks the agency inbox.",
		priority: "HIGH" as const,
		subject: "Manuel Ángel's Fulham move",
		body:
			"Hi Best of You team,\n\nManuel Ángel's move from Real Madrid to Fulham, together with his arrival at Best of You this month, is a very current change of stage for a young player. It feels like a natural moment to look at how the media around that step is being handled.\n\nIBL supports players with the practical work around career moments — matchday content, Stories and the day-to-day account management that keeps a profile consistent. Does Manuel already have dedicated support for the move, or is another Best of You player a better place to start?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://www.bestofyou.es/en/welcome-manuel-angel/",
			"https://www.realmadrid.com/es-ES/noticias/club/comunicados/comunicado-oficial-manuel-angel-01-09-2026",
			"https://www.bestofyou.es/en/",
		],
	},
	{
		key: "AGT-0135",
		email: "info@eagleeye.com.py",
		language: "English",
		mailboxType: "GENERAL" as const,
		hookType: "INTERNATIONAL_VISIBILITY" as const,
		routeQuality:
			"Published Eagle Eye general inbox; route is linked to Diego Serrati and the agency; CONTACT_ONCE required",
		researchSummary:
			"Eagle Eye's current official player list includes Damián Bobadilla at São Paulo and presents a broad Paraguay-focused professional roster. São Paulo's official site records Bobadilla returning to the club after playing four matches for Paraguay at the 2026 World Cup. The route is the agency inbox, not a verified private mailbox. Confidence: high.",
		whyNow:
			"Damián Bobadilla's return to São Paulo after a first World Cup gives Eagle Eye a concrete club-and-country moment to work around. It is a useful reason to discuss consistent media support around international visibility while keeping the conversation open to another Eagle Eye player.",
		playerEntryPoint:
			"Damián Bobadilla is the current public hook; ask whether he or another Eagle Eye player is the right first conversation.",
		credibilityAngle:
			"IBL's experience around international visibility is relevant to the practical media work that sits between national-team attention and a player's club rhythm.",
		ctaApproach:
			"Ask how Bobadilla's media is currently handled after the World Cup, or whether another Eagle Eye player would be more relevant.",
		ctaWhy:
			"The route is a general agency inbox, so the CTA asks for the correct internal contact rather than addressing Diego personally.",
		followUpApproach:
			"Follow-up one asks who owns the media side for Bobadilla; follow-up two offers a brief outline of IBL's support and then parks the route.",
		priority: "NORMAL" as const,
		subject: "Damián Bobadilla after the World Cup",
		body:
			"Hi Eagle Eye team,\n\nDamián Bobadilla returning to São Paulo after playing four matches for Paraguay at the World Cup is a clear club-and-country moment for his public profile.\n\nIBL helps players keep that side of the story consistent through matchday content, Stories and the day-to-day account work around the football. How is Damián's media currently handled, or is another Eagle Eye player a better place to start?\n\n" +
			senderSignature,
		sourceUrls: [
			"https://eagleeye.com.py/pt",
			"https://www.saopaulofc.net/elenco-se-reapresenta-com-o-retorno-de-bobadilla/",
			"https://www.saopaulofc.net/atleta/bobadilla/",
		],
	},
] as const;

function screeningScore(item: {
	normalizedEmail: string | null;
	agencyName: string | null;
	routes: Array<{
		route: {
			type: string;
			normalizedValue: string;
			mailboxType: string;
			routeUsage: string;
		};
	}>;
	sourceRecords: Array<{ rawValues: unknown }>;
}) {
	const email = item.normalizedEmail ?? "";
	const domain = email.split("@")[1] ?? "";
	const emailRoute = item.routes.find(
		(link) =>
			link.route.type === "EMAIL" && link.route.normalizedValue === email,
	)?.route;
	const raw = (item.sourceRecords[0]?.rawValues ?? {}) as Record<
		string,
		unknown
	>;
	let score = 0;
	if (domain && !freeMailDomains.has(domain)) score += 10;
	if (emailRoute && emailRoute.mailboxType !== "UNKNOWN") score += 4;
	if (emailRoute?.routeUsage === "CONTACT_ONCE") score += 2;
	if (item.routes.some((link) => link.route.type === "LINKEDIN")) score += 2;
	if (
		typeof raw.Notes === "string" &&
		/verified|complete|strong/i.test(raw.Notes)
	)
		score += 2;
	if (item.agencyName) score += 1;
	return score;
}

async function screenBacklog(batchId: string) {
	const items = await db.prospectBacklogItem.findMany({
		where: {
			batchId,
			state: "NOT_REVIEWED",
			entityType: { in: ["PERSON", "COMPANY"] },
			normalizedEmail: { not: null },
		},
		include: {
			routes: { include: { route: true } },
			sourceRecords: { take: 1 },
		},
	});
	const selected = items
		.map((item) => ({ item, score: screeningScore(item) }))
		.sort(
			(a, b) =>
				b.score - a.score ||
				a.item.canonicalKey.localeCompare(b.item.canonicalKey),
		)
		.slice(0, 300);
	const processedAt = new Date();
	let screened = 0;
	let protectedCount = 0;
	for (const { item } of selected) {
		const matches = await findProtectedPlayerMatches(db, [item.displayName]);
		if (matches.length > 0) {
			await db.prospectBacklogItem.update({
				where: { id: item.id },
				data: {
					state: "SUPPRESSED",
					lastProcessedAt: processedAt,
					reviewReason:
						"Protected player policy: do not prospect this player as a new IBL client. This state does not infer other commercial, payment, contract, or relationship status.",
				},
			});
			protectedCount += 1;
			continue;
		}
		await db.prospectBacklogItem.update({
			where: { id: item.id },
			data: {
				state: "NEEDS_ENRICHMENT",
				lastProcessedAt: processedAt,
				nextReviewAt: new Date(processedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
				reviewReason:
					"Extended preparation screen: staged identity and professional route prioritized for deeper agency, roster, relationship and media-opportunity research; no active Lead created.",
			},
		});
		screened += 1;
	}
	return {
		available: items.length,
		selected: selected.length,
		screened,
		protectedCount,
	};
}

async function prepareCandidate(
	batchId: string,
	pilotId: string,
	candidate: (typeof deepCandidates)[number],
	rank: number,
) {
	if (!supportedLanguages.has(candidate.language))
		throw new Error(`Unsupported language for ${candidate.key}`);
	const item = await db.prospectBacklogItem.findUnique({
		where: { batchId_canonicalKey: { batchId, canonicalKey: candidate.key } },
		include: { routes: { include: { route: true } } },
	});
	if (!item) throw new Error(`Missing backlog item ${candidate.key}`);
	if (item.state === "READY")
		return { key: candidate.key, skipped: "already-ready" };
	if (item.state !== "NEEDS_ENRICHMENT")
		throw new Error(
			`${candidate.key} is not in an enrichable state: ${item.state}`,
		);
	const routeLink = item.routes.find(
		(link) =>
			link.route.type === "EMAIL" &&
			link.route.normalizedValue === candidate.email,
	);
	if (!routeLink) throw new Error(`Missing staged route for ${candidate.key}`);
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
		throw new Error(
			`${candidate.key} mailbox type mismatch: ${classification.mailboxType} vs ${candidate.mailboxType}`,
		);
	if (classification.routeUsage !== "CONTACT_ONCE")
		throw new Error(`CONTACT_ONCE is not enforced for ${candidate.key}`);
	const quality = validatePreparedOutreach({
		language: candidate.language,
		hookType: candidate.hookType,
		whyNow: candidate.whyNow,
		researchSummary: candidate.researchSummary,
		sourceUrls: [...candidate.sourceUrls],
	});
	if (!quality.valid) throw new Error(`${candidate.key}: ${quality.reason}`);
	await assertPreparedPlayerAllowed(db, [candidate.playerEntryPoint]);
	const [
		existingContactRoute,
		suppressedEmail,
		suppressedDomain,
		activeLeadCount,
		threadCount,
	] = await Promise.all([
		db.contactRoute.findUnique({
			where: {
				type_normalizedValue: {
					type: "EMAIL",
					normalizedValue: candidate.email,
				},
			},
		}),
		db.suppressedContact.findUnique({ where: { email: candidate.email } }),
		db.suppressedDomain.findUnique({
			where: { domain: candidate.email.split("@")[1] ?? "" },
		}),
		db.lead.count({
			where: {
				contact: {
					contactRoutes: {
						some: { type: "EMAIL", normalizedValue: candidate.email },
					},
				},
				status: { notIn: ["ARCHIVED", "DISQUALIFIED"] },
			},
		}),
		db.emailThread.count({
			where: {
				contact: {
					contactRoutes: {
						some: { type: "EMAIL", normalizedValue: candidate.email },
					},
				},
			},
		}),
	]);
	if (
		existingContactRoute ||
		suppressedEmail ||
		suppressedDomain ||
		activeLeadCount > 0 ||
		threadCount > 0
	)
		throw new Error(`Safety check failed for ${candidate.key}`);
	await db.prospectBacklogItem.update({
		where: { id: item.id },
		data: {
			state: "READY",
			lastProcessedAt: new Date(),
			reviewReason:
				"Extended preparation: current roster or player opportunity and route were independently verified from public sources; staged only; no active Lead or outbound queue created.",
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
			researchConfidence:
				candidate.mailboxType === "UNKNOWN" ? "MEDIUM-HIGH" : "HIGH",
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
			routeVisibility: "SHARED",
			mailboxType: classification.mailboxType,
			mailboxTypeEvidence: classification.mailboxTypeEvidence,
			routeUsage: classification.routeUsage,
			routeConfidence: candidate.mailboxType === "UNKNOWN" ? "MEDIUM" : "HIGH",
			researchSummary: candidate.researchSummary,
			researchConfidence:
				candidate.mailboxType === "UNKNOWN" ? "MEDIUM-HIGH" : "HIGH",
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
	return {
		key: candidate.key,
		name: item.displayName,
		agency: item.agencyName,
		email: candidate.email,
		mailboxType: classification.mailboxType,
		routeConfidence: candidate.mailboxType === "UNKNOWN" ? "MEDIUM" : "HIGH",
		researchConfidence:
			candidate.mailboxType === "UNKNOWN" ? "MEDIUM-HIGH" : "HIGH",
		priority: candidate.priority,
	};
}

async function main() {
	if (process.env.ATLAS_LIVE_OUTREACH_ENABLED !== "false")
		throw new Error("ATLAS_LIVE_OUTREACH_ENABLED must be explicitly false");
	const batch = await db.prospectSourceBatch.findFirst({
		where: { filename },
		orderBy: { importedAt: "desc" },
	});
	if (!batch) throw new Error("The workbook source batch is not loaded.");
	const screening = await screenBacklog(batch.id);
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
	const prepared = [];
	for (const [index, candidate] of deepCandidates.entries()) {
		prepared.push(
			await prepareCandidate(batch.id, pilot.id, candidate, index + 1),
		);
	}
	const states = await db.prospectBacklogItem.groupBy({
		by: ["state"],
		where: { batchId: batch.id },
		_count: { _all: true },
	});
	const mailboxTypes = await db.prospectBacklogRoute.groupBy({
		by: ["mailboxType"],
		where: { batchId: batch.id, type: "EMAIL" },
		_count: { _all: true },
	});
	console.log(
		JSON.stringify(
			{
				batchId: batch.id,
				pilotId: pilot.id,
				screening,
				prepared,
				deepResearchCandidates: deepCandidates.length,
				backlogStateCounts: states,
				mailboxTypeCounts: mailboxTypes,
				activeLeadsCreated: 0,
				emailsQueued: 0,
			},
			null,
			2,
		),
	);
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
	});
