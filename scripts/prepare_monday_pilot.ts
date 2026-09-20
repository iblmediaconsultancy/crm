import { randomUUID } from "node:crypto";
import { db } from "../packages/db/src/index";

const filename = "IBL_Football_CRM_Master_Deduplicated_Expanded(1).xlsx";
const supportedLanguages = new Set(["English", "Dutch", "Turkish"]);

const candidates = [
	{
		key: "AGT-0072",
		routeQuality: "Exact workbook route boaz@boazgoren.com; named agency contact; shared route; contact-once required",
		researchSummary: "Identity is consistent with Boaz Goren and BG Sports. The agency profile identifies its Israeli-to-Europe focus. Union Saint-Gilloise officially announced on 15 August 2026 that Anan Khalaili moved to Crystal Palace after two seasons in Brussels. Confidence: medium-high.",
		whyNow: "Khalaili's move into the Premier League is a live, public next-chapter moment for an Israeli-to-Europe representation story. It gives the email a concrete reason to ask whether BG Sports has a player story worth shaping now, without assuming IBL represents Khalaili.",
		playerEntryPoint: "Anan Khalaili is the timely public reference; ask whether he or another current BG Sports player is the appropriate entry point.",
		language: "English",
		proposedSubject: "Anan Khalaili's next chapter",
		proposedBody: "Hi Boaz,\n\nUnion Saint-Gilloise has just announced Anan Khalaili's move to Crystal Palace after two seasons in Brussels. That is a timely moment in an Israeli-to-Premier League story, and it made me wonder whether there is a useful media angle around the next chapter rather than only the transfer itself.\n\nI work with IBL Media Consultancy on focused football media and player positioning. Would a short conversation be useful to see whether Khalaili, or another BG Sports player with a current news moment, is the right fit for that kind of work?\n\nBest,\nIhsan",
		sourceUrls: ["https://www.footballagencies.com/football-agency/bg-sports-management-by-boaz-goren/", "https://rusg.brussels/en/news/khalaili-makes-move-premier-league"],
	},
	{
		key: "AGT-0140",
		routeQuality: "Exact workbook route diogohenriques@sportsbloom.com; named agency contact; shared route; contact-once required",
		researchSummary: "Identity is consistent with Diogo Correia Henriques and SPORTSBLOOM. The agency profile identifies its Lisbon Portugal-Brazil footprint. AZ extended Alexandre Penetra's contract through 2029 in December 2025, and AZ's 2026 match coverage records his late winner against Excelsior. Confidence: medium-high.",
		whyNow: "Penetra's contract extension and continued first-team visibility give SPORTSBLOOM a specific player-development moment to discuss now, particularly around communicating a long-term club commitment without a generic agency pitch.",
		playerEntryPoint: "Alexandre Penetra is the specific public hook; confirm with Diogo whether he is the right current client for an IBL conversation.",
		language: "English",
		proposedSubject: "Alexandre Penetra's AZ chapter",
		proposedBody: "Hi Diogo,\n\nAZ's decision to extend Alexandre Penetra through 2029, followed by his late winner against Excelsior this season, caught my attention. It is a strong moment in a player's story because the contract commitment and the match impact are happening together.\n\nI work with IBL Media Consultancy on focused football media and player positioning. Would it be useful to compare notes on whether Penetra, or another SPORTSBLOOM player with a timely story, is the right place for a selective media idea?\n\nBest,\nIhsan",
		sourceUrls: ["https://www.footballagencies.com/football-agency/sportsbloom/", "https://www.az.nl/inside-az/nieuws/2025/december/penetra-langer-in-alkmaar", "https://www.az.nl/inside-az/nieuws/2026/februari/liveblog-excelsior-rotterdam-az"],
	},
	{
		key: "AGT-0141",
		routeQuality: "Exact workbook route diogo@websoccer.com.br; named agency contact; shared route; contact-once required",
		researchSummary: "Identity is consistent with Diogo and Web Soccer do Brasil. The agency profile describes a Brazil-to-Europe pathway. FC Alverca announced on 28 June 2026 that Kaiky Naves' loan ended after 34 matches and three goals and that he returned to his parent club. Confidence: medium.",
		whyNow: "The end of Naves' Alverca loan is a real transition point: the next club decision and the meaning of a successful 34-match European season are both live. That creates a specific reason to ask whether Web Soccer wants to shape the next chapter, without guessing where he goes next.",
		playerEntryPoint: "Kaiky Naves is the timely public reference; ask Diogo whether Naves or another Web Soccer player is the appropriate entry point.",
		language: "English",
		proposedSubject: "Kaiky Naves after the Alverca loan",
		proposedBody: "Hi Diogo,\n\nFC Alverca has announced that Kaiky Naves' loan has ended after 34 appearances and three goals, with the defender returning to his parent club. That makes the next step in his European story a clear moment to communicate carefully, without assuming what the next move will be.\n\nI work with IBL Media Consultancy on focused football media and player positioning. Would you be open to a short conversation about whether Naves, or another Web Soccer player at a similar transition point, is worth exploring now?\n\nBest,\nIhsan",
		sourceUrls: ["https://www.footballagencies.com/football-agency/web-soccer-do-brasil/", "https://www.alvercasad.pt/kaiky-naves-termina-emprestimo/"],
	},
	{
		key: "AGT-0155",
		routeQuality: "Exact workbook route eduardo@promofut.com.mx; second agency route also staged; shared route; contact-once required",
		researchSummary: "Identity is consistent with Eduardo Hernández and PROMOFUT. The agency profile places PROMOFUT in Mexico and Liga MX/international representation. Atlas FC announced on 17 September 2026 that Jorge Sánchez was called into Mexico's September-October international window after joining Atlas in the summer. Confidence: medium.",
		whyNow: "Sánchez's new Atlas chapter and immediate Mexico call-up create a current national-team media moment. It is a genuine reason to ask PROMOFUT whether there is a useful player-story angle now, while keeping outreach in English under Atlas's language policy.",
		playerEntryPoint: "Jorge Sánchez is the specific public hook; use the primary Eduardo route only and do not also contact the second shared route.",
		language: "English",
		proposedSubject: "Jorge Sánchez and the September Mexico window",
		proposedBody: "Hi Eduardo,\n\nAtlas FC announced this week that Jorge Sánchez has been called into Mexico's September-October international window, shortly after beginning a new chapter with the club. That combination of a fresh club setting and an immediate national-team moment feels like a timely story to handle with care.\n\nI work with IBL Media Consultancy on focused football media and player positioning. Would a short conversation be useful to see whether Sánchez, or another PROMOFUT player with a current moment, is the right fit for a selective media idea?\n\nBest,\nIhsan",
		sourceUrls: ["https://www.footballagencies.com/football-agency/promofut/", "https://www.atlasfc.com.mx/post/de-la-academia-al-tricolor-jorge-sanchez-el-primer-seleccionado-nacional-de-la-era-grupo-prodi-en-atlas-fc"],
	},
	{
		key: "AGT-0217",
		routeQuality: "Exact workbook route ginescarvajal@nescarsport.es; named agency contact; shared route; contact-once required",
		researchSummary: "Identity is consistent with Ginés Carvajal Seller and Be Loyal. The agency profile lists a Madrid base and public Real Madrid-linked roster. Real Madrid's official 12 September 2026 report says Álvaro Carreras won a penalty and scored in the 4-1 win over Rayo Vallecano. Confidence: medium-high.",
		whyNow: "Carreras' goal and decisive role in a recent Bernabéu win is a precise, current media moment for a Be Loyal player. It makes the email relevant without claiming a relationship with the player or assuming Carreras is the correct commercial entry point.",
		playerEntryPoint: "Álvaro Carreras is the specific public hook; ask Ginés whether Carreras or another Be Loyal player is the appropriate conversation.",
		language: "English",
		proposedSubject: "Álvaro Carreras after the Rayo win",
		proposedBody: "Hi Ginés,\n\nÁlvaro Carreras' performance against Rayo Vallecano on 12 September stood out: he won the penalty for Real Madrid's opener and scored the second in a 4-1 Bernabéu win. That is the kind of current moment where a player's story can be shaped beyond the match report, if the timing is right.\n\nI work with IBL Media Consultancy on focused football media and player positioning. Would you be open to a short conversation about whether Carreras, or another Be Loyal player, has a story worth developing now?\n\nBest,\nIhsan",
		sourceUrls: ["https://www.footballagencies.com/football-agency/be-loyal-by-gines-carvajal/", "https://www.realmadrid.com/es-ES/noticias/futbol/primer-equipo/actualidad/carreras-destaco-la-intensidad-desde-el-primer-minuto-12-09-2026"],
	},
	{
		key: "AGT-0277",
		routeQuality: "Exact workbook route jim@solution.as; named agency mailbox among multiple shared routes; contact-once required",
		researchSummary: "Identity is consistent with Jim Solbakken and Player Solution. The agency profile describes a Nordic-to-Europe focus. Molde announced on 13 July 2026 that Mathias Fjørtoft Løvik returned home after 18 months abroad, with a possible immediate return debut. Confidence: medium-high.",
		whyNow: "Løvik's return to Molde after time abroad is a concrete re-entry moment for a Nordic player pathway. Because Player Solution has several shared routes, the pilot uses one named route only and asks Jim to identify the right story.",
		playerEntryPoint: "Mathias Fjørtoft Løvik is the specific public hook; use jim@solution.as only and do not duplicate the message to other Player Solution routes.",
		language: "English",
		proposedSubject: "Mathias Løvik's return to Molde",
		proposedBody: "Hi Jim,\n\nMolde announced in July that Mathias Fjørtoft Løvik had returned home after 18 months abroad, describing the move as the next step after his experience in Italy and Turkey. That kind of return gives a player story a real before-and-after moment, rather than just another transfer update.\n\nI work with IBL Media Consultancy on focused football media and player positioning. Would it be useful to compare notes on whether Løvik, or another Player Solution player at a similar transition point, is worth exploring now?\n\nBest,\nIhsan",
		sourceUrls: ["https://www.footballagencies.com/football-agency/jim-solbakken-player-solution/", "https://www.moldefk.no/nyheter/mathias-lovik-vender-hjem-til-molde", "https://www.trabzonspor.org.tr/tr/haberler/kamuoyuna-duyuru-61-13-07-2026"],
	},
	{
		key: "AGT-0376",
		routeQuality: "Exact workbook route mark.volders@profimanagement.be; named agency contact; shared route; contact-once required",
		researchSummary: "Identity is consistent with Mark Volders and Profi-Management. The agency profile identifies a Belgian goalkeeper-specialist focus and lists Senne Lammens. Manchester United's current profile says Lammens is in Belgium's 2026 World Cup squad, while the Premier League named him 2025/26 Transfer of the Season after 32 appearances and eight clean sheets. Confidence: high for the player event, medium for agency affiliation.",
		whyNow: "Lammens' award-winning first United season and World Cup status give a goalkeeper-specific story a clear current platform. That is a stronger opening than a generic introduction to a specialist agency.",
		playerEntryPoint: "Senne Lammens is the specific public hook; ask Mark whether Lammens or another Profi goalkeeper is the appropriate conversation.",
		language: "English",
		proposedSubject: "Senne Lammens after his United breakthrough",
		proposedBody: "Hi Mark,\n\nSenne Lammens' first Manchester United season has created a very specific media moment: the Premier League named him its 2025/26 Transfer of the Season, and United list him in Belgium's 2026 World Cup squad. For a goalkeeper, that combination of performance, recognition and international visibility is unusually clear.\n\nI work with IBL Media Consultancy on focused football media and player positioning. Would you be open to a short conversation about whether Lammens, or another Profi goalkeeper, is the right fit for a selective story now?\n\nBest,\nIhsan",
		sourceUrls: ["https://www.footballagencies.com/football-agency/profi-management-agency/", "https://www.manutd.com/en/teams/mens-team/senne-lammens", "https://www.premierleague.com/en/news/4672279/lammens-named-barclays-transfer-of-the-season"],
	},
	{
		key: "AGT-0407",
		routeQuality: "Exact workbook route michael@mbsports.dk; named agency contact; shared route; contact-once required",
		researchSummary: "Identity is consistent with Michael Bolvig and MB Sports; DBU lists Michael Bolvig as a registered agent at mbsports.dk. Rangers announced Andreas Skov Olsen's January 2026 loan, and the club's May coverage records him in the matchday squad during the season. Confidence: medium-high.",
		whyNow: "Skov Olsen's move into Scottish football and visible Rangers role give MB Sports a specific cross-market player story to discuss. The route is shared, so the pilot contacts Michael once and does not also approach another MB Sports mailbox.",
		playerEntryPoint: "Andreas Skov Olsen is the specific public hook; use Michael's route once and confirm whether he is the right current player for an IBL conversation.",
		language: "English",
		proposedSubject: "Andreas Skov Olsen's Rangers chapter",
		proposedBody: "Hi Michael,\n\nRangers' announcement of Andreas Skov Olsen's move from Wolfsburg into Scottish football, followed by his involvement across the season, caught my attention. It is a useful moment in a Denmark-to-new-market story because the move itself is now becoming a body of work rather than just a transfer headline.\n\nI work with IBL Media Consultancy on focused football media and player positioning. Would a short conversation be useful to see whether Skov Olsen, or another MB Sports player crossing into a new market, is the right fit for a selective media idea?\n\nBest,\nIhsan",
		sourceUrls: ["https://www.footballagencies.com/football-agency/mb-sports-aps/", "https://dbu.dk/uddannelse/football-agents/list-of-registered-football-agents/", "https://www.rangers.co.uk/article/rangers-announce-signing-of-andreas-skov-olsen/1RceWlSmRl4hnxDKH7plXw", "https://www.rangers.co.uk/article/team-news-rohl-makes-three-changes-for-old-firm/5mnVgoICLQI1UqoZW24nnR"],
	},
] as const;

async function main() {
	const batch = await db.prospectSourceBatch.findFirst({
		where: { filename },
		orderBy: { importedAt: "desc" },
	});
	if (!batch) throw new Error("The workbook source batch is not loaded.");
	for (const candidate of candidates) {
		if (!supportedLanguages.has(candidate.language)) {
			throw new Error(`Unsupported Atlas outreach language for ${candidate.key}: ${candidate.language}`);
		}
	}
	const pilot = await db.prospectBacklogPilot.upsert({
		where: { batchId_name: { batchId: batch.id, name: "Monday controlled pilot" } },
		create: { id: randomUUID(), batchId: batch.id, name: "Monday controlled pilot", status: "PREPARED" },
		update: { status: "PREPARED", preparedAt: new Date() },
	});
	for (const [index, candidate] of candidates.entries()) {
		const item = await db.prospectBacklogItem.findUnique({
			where: { batchId_canonicalKey: { batchId: batch.id, canonicalKey: candidate.key } },
		});
		if (!item) throw new Error(`Missing backlog item ${candidate.key}`);
		await db.prospectBacklogItem.update({
			where: { id: item.id },
			data: {
				state: "READY",
				lastProcessedAt: new Date(),
				reviewReason: "Monday pilot prepared from staged workbook data and current public sources; approved language set is English, Dutch, or Turkish; no active Lead created.",
			},
		});
		await db.prospectBacklogPilotItem.upsert({
			where: { pilotId_itemId: { pilotId: pilot.id, itemId: item.id } },
			create: {
				id: randomUUID(), pilotId: pilot.id, itemId: item.id, rank: index + 1,
				routeQuality: candidate.routeQuality, researchSummary: candidate.researchSummary,
				whyNow: candidate.whyNow, playerEntryPoint: candidate.playerEntryPoint,
				language: candidate.language, proposedSubject: candidate.proposedSubject,
				proposedBody: candidate.proposedBody, sourceUrls: candidate.sourceUrls, status: "PREPARED",
			},
			update: {
				rank: index + 1, routeQuality: candidate.routeQuality, researchSummary: candidate.researchSummary,
				whyNow: candidate.whyNow, playerEntryPoint: candidate.playerEntryPoint,
				language: candidate.language, proposedSubject: candidate.proposedSubject,
				proposedBody: candidate.proposedBody, sourceUrls: candidate.sourceUrls, status: "PREPARED",
			},
		});
	}
	console.log(JSON.stringify({ batchId: batch.id, pilotId: pilot.id, candidates: candidates.length, activeLeadsCreated: 0, emailsSent: 0, languages: [...new Set(candidates.map((candidate) => candidate.language))] }, null, 2));
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
	});
