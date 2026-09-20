import { randomUUID } from "node:crypto";
import { db } from "../packages/db/src/index";

const filename = "IBL_Football_CRM_Master_Deduplicated_Expanded(1).xlsx";
const supportedLanguages = new Set(["English", "Dutch", "Turkish"]);
const senderSignature = "Kind regards,\n\nIhsan | Founder, IBL Media Consultancy\niblmedia.com\nWhatsApp: +31 6 27833383";

function withSenderSignature(body: string, language: string): string {
	const signature = language === "Dutch"
		? "Met vriendelijke groet,\n\nIhsan | Founder, IBL Media Consultancy\niblmedia.com\nWhatsApp: +31 6 27833383"
		: senderSignature;
	return `${body.replace(/\n\n(?:Best,|Groet,)\nIhsan$/, "")}\n\n${signature}`;
}

const candidates = [
	{
		key: "AGT-0072",
		routeQuality: "Exact workbook route boaz@boazgoren.com; named agency contact; shared route; contact-once required",
		researchSummary: "Identity is consistent with Boaz Goren and BG Sports. The agency profile identifies its Israeli-to-Europe focus. Union Saint-Gilloise officially announced on 15 August 2026 that Anan Khalaili moved to Crystal Palace after two seasons in Brussels. Confidence: medium-high.",
		whyNow: "Khalaili's move into the Premier League is a live, public next-chapter moment for an Israeli-to-Europe representation story. It gives the email a concrete reason to ask whether BG Sports has a player story worth shaping now, without assuming IBL represents Khalaili.",
		playerEntryPoint: "Anan Khalaili is the timely public reference; ask whether he or another current BG Sports player is the appropriate entry point.",
		language: "English",
		proposedSubject: "Anan Khalaili's next chapter",
		proposedBody: "Hi BG Sports team,\n\nAnan Khalaili's move from Union Saint-Gilloise to Crystal Palace is a strong next step in his career. The media around a move like that usually has a short window to work well, especially across matchday content and the player's own channels.\n\nWe already manage media for players across Premier League, international and emerging-talent environments. How do you currently handle that for Khalaili, or is another BG Sports player the better place to start?\n\nBest,\nIhsan",
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
		proposedBody: "Hi SPORTSBLOOM team,\n\nAlexandre Penetra has the kind of AZ moment that is worth keeping visible: a new contract through 2029 and a late winner this season.\n\nFor players in that position, we usually help keep matchday content, Stories and the longer-term account direction consistent. Does Alexandre already have that covered, or would another player in the SPORTSBLOOM roster be more relevant?\n\nBest,\nIhsan",
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
		proposedBody: "Hi Web Soccer team,\n\nKaiky Naves is coming off a 34-game spell at Alverca and is now back with his parent club. That is a useful point to make sure the story does not go quiet between one decision and the next.\n\nAt IBL, that can mean account management, matchday content and a few well-timed Stories rather than a heavy campaign. Does Naves already have that support, or is another Web Soccer player at a similar moment a better conversation?\n\nBest,\nIhsan",
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
		proposedBody: "Hi PROMOFUT team,\n\nJorge Sánchez has a new Atlas chapter and an immediate Mexico window around it. That gives his channels something real to work with now, not just another transfer announcement.\n\nWe already manage media for players across Premier League, international and emerging-talent environments. How are you handling Jorge's content around this window, and who would be the right person to speak with if support is useful?\n\nBest,\nIhsan",
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
		proposedBody: "Hi Be Loyal team,\n\nÁlvaro Carreras winning the penalty and scoring against Rayo Vallecano on 12 September was a very clear public moment. The useful question is what happens to that attention after the match.\n\nWe help with the practical side: matchday content, captions, Stories and keeping the account moving when a player is in the spotlight. Does Carreras already have that support, or is another Be Loyal player more relevant?\n\nBest,\nIhsan",
		sourceUrls: ["https://www.footballagencies.com/football-agency/be-loyal-by-gines-carvajal/", "https://www.realmadrid.com/es-ES/noticias/futbol/primer-equipo/actualidad/carreras-destaco-la-intensidad-desde-el-primer-minuto-12-09-2026"],
	},
	{
		key: "AGT-0426",
		routeQuality: "Exact workbook route office@beckster.international; shared Beckster agency route; contact-once required",
		researchSummary: "Identity is consistent with Mikkel Beck and Beckster International. The staged route is a published professional agency inbox. HB Køge officially announced on 2 September 2026 that Fisnik Isaki joined from B.93 on a three-year contract; current public Beckster activity identifies the move as part of its player work. Confidence: medium-high.",
		whyNow: "Isaki's three-year move to HB Køge is a fresh agency-and-player moment, with the first match and new club story still current. It gives Beckster a concrete reason to discuss media support while leaving room for another player in its wider roster.",
		playerEntryPoint: "Fisnik Isaki is the current public hook; use the shared Beckster inbox once and ask whether he or another player is the better starting point.",
		language: "English",
		proposedSubject: "Fisnik Isaki's new chapter at HB Køge",
		proposedBody: "Hi Beckster team,\n\nFisnik Isaki has just joined HB Køge on a three-year deal after his time at B.93. A new club and a fresh role give his channels something specific to build around now.\n\nAt IBL, we help with the practical side of those moments: social media management, matchday content and keeping the account consistent as the player settles in. Is Fisnik already covered, or is another Beckster player more relevant?\n\nBest,\nIhsan",
		sourceUrls: ["https://www.footballagencies.com/football-agency/beckster-international-sarl/", "https://www.hbkoge.dk/nyhed/hb-koege-koeber-isaki-fri-af-b-93/", "https://www.sotwe.com/hashtag/becksterinternational?lang=en"],
	},
	{
		key: "AGY-0166",
		routeQuality: "Exact workbook route gestifute@gestifute.com; shared Gestifute agency route; contact-once required",
		researchSummary: "The staged agency record identifies Gestifute by Jorge Mendes and two shared professional inboxes. Gestifute sources identify Mateus Fernandes as a current client; Tottenham officially announced his move from West Ham on 2 July 2026 and included him in its submitted 2026/27 Premier League squad on 3 September. Confidence: medium-high.",
		whyNow: "Fernandes is now entering a first Tottenham Premier League season after a major move from West Ham, making the club transition and ongoing content around it genuinely current. The hook opens naturally to another Gestifute player without treating the shared inbox as a personal address.",
		playerEntryPoint: "Mateus Fernandes is the specific public hook; use gestifute@gestifute.com once and ask whether another Gestifute player is more relevant for media support.",
		language: "English",
		proposedSubject: "Mateus Fernandes' first Tottenham season",
		proposedBody: "Hi Gestifute team,\n\nMateus Fernandes has moved from West Ham into his first Tottenham season, with the club now listing him in its 2026/27 Premier League squad. That is the point where the story shifts from transfer announcement to the player's day-to-day presence at a new club.\n\nWe already manage media for players across Premier League, international and emerging-talent environments. How is Mateus' media handled around this transition, or is another Gestifute player the better place to start?\n\nBest,\nIhsan",
		sourceUrls: ["https://www.footballagencies.com/football-agency/gestifute-by-jorge-mendes/", "https://www.footballagencies.com/news/jorge-mendes-and-gestifute-deliver-record-ps85m-mateus-fernandes-move-to-tottenham/", "https://www.tottenhamhotspur.com/news/1076042/mateus-fernandes-signs", "https://www.tottenhamhotspur.com/news/1088296/squad-confirmed-for-202627"],
	},
	{
		key: "AGT-0407",
		routeQuality: "Exact workbook route michael@mbsports.dk; named agency contact; shared route; contact-once required",
		researchSummary: "Identity is consistent with Michael Bolvig and MB Sports; DBU lists Michael Bolvig as a registered agent at mbsports.dk. Rangers announced Andreas Skov Olsen's January 2026 loan, and the club's May coverage records him in the matchday squad during the season. Confidence: medium-high.",
		whyNow: "Skov Olsen's move into Scottish football and visible Rangers role give MB Sports a specific cross-market player story to discuss. The route is shared, so the pilot contacts Michael once and does not also approach another MB Sports mailbox.",
		playerEntryPoint: "Andreas Skov Olsen is the specific public hook; use Michael's route once and confirm whether he is the right current player for an IBL conversation.",
		language: "English",
		proposedSubject: "Andreas Skov Olsen's Rangers chapter",
		proposedBody: "Hi MB Sports team,\n\nAndreas Skov Olsen's move into Scottish football is now more than a transfer announcement; Rangers is becoming his day-to-day setting.\n\nThat is where consistent matchday content and personal-brand work can help. How do you currently handle that for Andreas, or is another MB Sports player the more useful place to begin?\n\nBest,\nIhsan",
		sourceUrls: ["https://www.footballagencies.com/football-agency/mb-sports-aps/", "https://dbu.dk/uddannelse/football-agents/list-of-registered-football-agents/", "https://www.rangers.co.uk/article/rangers-announce-signing-of-andreas-skov-olsen/1RceWlSmRl4hnxDKH7plXw", "https://www.rangers.co.uk/article/team-news-rohl-makes-three-changes-for-old-firm/5mnVgoICLQI1UqoZW24nnR"],
	},
	{
		key: "AGT-0010",
		routeQuality: "Exact workbook route brazil@rocnation.com; shared Roc Nation route linked to multiple people and the agency; contact-once required",
		researchSummary: "Identity is consistent with Alan Redmond and Roc Nation Sports. The current workbook route is a shared Brazil mailbox. Olympique Lyonnais published the transfer of Malick Fofana to Sunderland on 2 September 2026; the move is also covered in current agency reporting. Confidence: medium-high for the transfer, medium for the route-to-person relationship.",
		whyNow: "Fofana's deadline-window move to Sunderland is a fresh change of club and market. It gives Roc Nation a concrete reason to discuss how the player's public story is handled after the announcement, while the shared route requires one route-level contact only.",
		playerEntryPoint: "Malick Fofana is the specific public hook; use the shared Brazil route once and ask whether Alan or another Roc Nation colleague is the right person.",
		language: "English",
		proposedSubject: "Malick Fofana after the Sunderland move",
		proposedBody: "Hi Roc Nation Brazil team,\n\nMalick Fofana's move from Lyon to Sunderland on 2 September is a clear change of club, league and country. It is also the point where the story needs to continue beyond the announcement.\n\nIBL supports the content and personal-brand side of those transitions. Could you point me to the person handling Fofana's media, or let me know if another Roc Nation player is more relevant?\n\nBest,\nIhsan",
		sourceUrls: ["https://finance.ol.fr/en/recent-announcements/", "https://fifa.sportsagentinstitute.com/en/blog/roc-nation-sports", "https://www.rocnation.com/news/category/news/"],
	},
	{
		key: "AGT-0059",
		routeQuality: "Exact workbook route mail@esselsports.nl; shared agency route linked to multiple people and the agency; contact-once required",
		researchSummary: "Identity is consistent with Bas Schothorst and Essel Sports Management. Essel's own site lists Melle Roede among its players, while AZ announced his return in June 2026 and his Jong AZ starting debut followed in August. Confidence: high for the player and club events, medium for the route-to-person relationship.",
		whyNow: "Roede's return to AZ after a development season away, followed by his first Jong AZ start, is a clean Dutch-language development story. The shared mailbox should be contacted once at agency level, not separately for every linked person.",
		playerEntryPoint: "Melle Roede is the specific public hook; ask whether Roede has dedicated support or whether another Essel player is more relevant.",
		language: "Dutch",
		proposedSubject: "Melle Roede terug bij AZ",
		proposedBody: "Hoi Essel-team,\n\nMelle Roede is terug bij AZ, heeft bijgetekend tot 2028 en is inmiddels gestart bij Jong AZ. Dat is een mooie volgende stap in zijn ontwikkeling.\n\nBij IBL helpen we spelers met social media, content rond wedstrijddagen en personal branding wanneer zo'n moment zich aandient. Heeft Melle daar al vaste ondersteuning voor, of is een andere Essel-speler op dit moment relevanter?\n\nGroet,\nIhsan",
		sourceUrls: ["https://www.esselsports.nl/portfolio/melle-roede/", "https://www.az.nl/inside-az/nieuws/2026/juni/melle-roede-keert-terug-bij-az", "https://az.nl/inside-az/nieuws/2026/augustus/liveblog-jong-az-mvv-maastricht"],
	},
] as const;

const reviewMetadata = {
	"AGT-0072": {
		routeVisibility: "SHARED",
		routeConfidence: "MEDIUM",
		researchConfidence: "HIGH",
		credibilityAngle: "IBL already manages media across Premier League, international and emerging-talent environments; the route-level message keeps the proof relevant without naming an unrelated player.",
		ctaApproach: "Ask how the BG Sports team handles media for Khalaili, or whether another roster player is the better starting point.",
		ctaWhy: "The route is shared, so the message addresses the team and leaves room for internal routing across the wider roster.",
		followUpApproach: "Follow-up one asks whether media is handled centrally or by individual players; follow-up two is a short close-the-loop note.",
		priority: "HIGH",
	},
	"AGT-0140": {
		routeVisibility: "SHARED",
		routeConfidence: "MEDIUM",
		researchConfidence: "HIGH",
		credibilityAngle: "Concrete matchday content, Stories and account direction around a contract and first-team performance moment.",
		ctaApproach: "Ask whether Penetra is already supported or whether another SPORTSBLOOM player is more relevant.",
		ctaWhy: "The shared route should be easy to forward internally rather than assuming the recipient personally owns Penetra's media.",
		followUpApproach: "Follow-up one asks who currently owns Penetra's media; follow-up two offers a short example of how IBL would structure a contract-and-matchday cycle.",
		priority: "HIGH",
	},
	"AGT-0141": {
		routeVisibility: "SHARED",
		routeConfidence: "MEDIUM",
		researchConfidence: "HIGH",
		credibilityAngle: "Practical account management, matchday content and Stories that keep a player visible between clubs without speculating about the next move.",
		ctaApproach: "Ask whether Naves is covered or whether another Web Soccer player at a similar point is more useful.",
		ctaWhy: "The route is shared and the transition is only the entry point into a wider roster conversation.",
		followUpApproach: "Follow-up one adds a practical observation about keeping content consistent between clubs; follow-up two closes politely without pressure.",
		priority: "HIGH",
	},
	"AGT-0155": {
		routeVisibility: "SHARED",
		routeConfidence: "MEDIUM",
		researchConfidence: "HIGH",
		credibilityAngle: "IBL manages the content and personal-brand layer around club changes and international-team windows.",
		ctaApproach: "Ask how the PROMOFUT team handles Jorge's media and who should receive a short overview if useful.",
		ctaWhy: "The route is shared, so the CTA prioritizes correct internal routing over forcing a meeting.",
		followUpApproach: "Follow-up one asks whether PROMOFUT has an internal media lead for Jorge; follow-up two offers to send a brief outline rather than forcing a meeting.",
		priority: "HIGH",
	},
	"AGT-0217": {
		routeVisibility: "SHARED",
		routeConfidence: "MEDIUM",
		researchConfidence: "HIGH",
		credibilityAngle: "IBL handles the practical content layer after high-visibility performances: matchday content, captions, Stories and account rhythm.",
		ctaApproach: "Ask whether Carreras is already supported or whether another Be Loyal player is more relevant.",
		ctaWhy: "The shared route and current match hook make a support check more natural than a generic sales call.",
		followUpApproach: "Follow-up one references the difference between one strong match and a repeatable content rhythm; follow-up two is a light close-the-loop note.",
		priority: "HIGH",
	},
	"AGT-0426": {
		routeVisibility: "SHARED",
		routeConfidence: "MEDIUM",
		researchConfidence: "MEDIUM",
		credibilityAngle: "IBL provides practical social media management, matchday content and account consistency around a player's move into a new club.",
		ctaApproach: "Ask whether Isaki is already covered or whether another Beckster player is more relevant.",
		ctaWhy: "The shared agency route is addressed at team level and keeps the conversation open beyond the named player.",
		followUpApproach: "Follow-up one asks who handles Isaki's media internally; follow-up two offers a short overview and then parks the route.",
		priority: "HIGH",
	},
	"AGY-0166": {
		routeVisibility: "SHARED",
		routeConfidence: "MEDIUM",
		researchConfidence: "HIGH",
		credibilityAngle: "IBL already manages media across Premier League, international and emerging-talent environments, relevant to a player starting a major new club chapter.",
		ctaApproach: "Ask how Mateus Fernandes' media is handled at Tottenham or whether another Gestifute player is more relevant.",
		ctaWhy: "The route is a shared agency inbox, so the CTA asks for the right internal entry point rather than assuming a personal owner.",
		followUpApproach: "Follow-up one asks who owns Fernandes' media internally; follow-up two offers a short outline and then parks the shared route.",
		priority: "HIGH",
	},
	"AGT-0407": {
		routeVisibility: "SHARED",
		routeConfidence: "MEDIUM",
		researchConfidence: "HIGH",
		credibilityAngle: "IBL supports the ongoing matchday content and personal-brand work that follows a move into a new football market.",
		ctaApproach: "Ask how the MB Sports team handles that for Skov Olsen, or whether another player is more pressing.",
		ctaWhy: "The shared route is addressed at agency level and deliberately leaves room for a better roster entry point.",
		followUpApproach: "Follow-up one asks whether the current priority is matchday content or longer-term personal-brand work; follow-up two is a short close.",
		priority: "NORMAL",
	},
	"AGT-0010": {
		routeVisibility: "SHARED",
		routeConfidence: "MEDIUM",
		researchConfidence: "MEDIUM",
		credibilityAngle: "IBL supports the content and personal-brand layer after a cross-border transfer, with the focus on continuity after the announcement.",
		ctaApproach: "Ask the Roc Nation Brazil team to route the message to Fofana's media contact or suggest another relevant player.",
		ctaWhy: "The route is shared and not verified as Alan's personal inbox, so internal routing is the safe, useful next step.",
		followUpApproach: "Follow-up one asks for the correct internal contact; follow-up two briefly offers to send a one-page outline and then parks the route.",
		priority: "HIGH",
	},
	"AGT-0059": {
		routeVisibility: "SHARED",
		routeConfidence: "MEDIUM",
		researchConfidence: "HIGH",
		credibilityAngle: "Nederlandstalige ondersteuning voor social media, wedstrijddag-content en personal branding rond een volgende ontwikkelingsstap.",
		ctaApproach: "Vraag of Roede al vaste ondersteuning heeft, of dat een andere Essel-speler relevanter is.",
		ctaWhy: "De route is een gedeelde inbox, dus de tekst kan intern worden doorgestuurd zonder aan te nemen dat Bas dit persoonlijk beheert.",
		followUpApproach: "Follow-up one asks who handles Roede's media internally; follow-up two is a short Dutch close-the-loop message.",
		priority: "NORMAL",
	},
} as const;

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
	for (const replacedKey of ["AGT-0277", "AGT-0376"]) {
		const replacedItem = await db.prospectBacklogItem.findUnique({
			where: { batchId_canonicalKey: { batchId: batch.id, canonicalKey: replacedKey } },
		});
		if (replacedItem) {
			await db.prospectBacklogItem.update({
				where: { id: replacedItem.id },
				data: {
					state: "NOT_REVIEWED",
					lastProcessedAt: new Date(),
					reviewReason: "Removed from the Monday pilot because the current hook was not fresh enough; returned to staged backlog for later review.",
				},
			});
		}
	}
	await db.prospectBacklogPilotItem.deleteMany({ where: { pilotId: pilot.id, rank: { in: [6, 7] } } });
	for (const [index, candidate] of candidates.entries()) {
		const metadata = reviewMetadata[candidate.key];
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
				routeVisibility: metadata.routeVisibility, routeConfidence: metadata.routeConfidence,
				researchConfidence: metadata.researchConfidence,
				whyNow: candidate.whyNow, playerEntryPoint: candidate.playerEntryPoint,
				credibilityAngle: metadata.credibilityAngle, ctaApproach: metadata.ctaApproach,
				ctaWhy: metadata.ctaWhy, followUpApproach: metadata.followUpApproach,
				language: candidate.language, proposedSubject: candidate.proposedSubject,
				priority: metadata.priority,
				proposedBody: withSenderSignature(candidate.proposedBody, candidate.language), sourceUrls: candidate.sourceUrls, status: "PREPARED",
			},
			update: {
				rank: index + 1, routeQuality: candidate.routeQuality, researchSummary: candidate.researchSummary,
				routeVisibility: metadata.routeVisibility, routeConfidence: metadata.routeConfidence,
				researchConfidence: metadata.researchConfidence,
				whyNow: candidate.whyNow, playerEntryPoint: candidate.playerEntryPoint,
				credibilityAngle: metadata.credibilityAngle, ctaApproach: metadata.ctaApproach,
				ctaWhy: metadata.ctaWhy, followUpApproach: metadata.followUpApproach,
				language: candidate.language, proposedSubject: candidate.proposedSubject,
				priority: metadata.priority,
				proposedBody: withSenderSignature(candidate.proposedBody, candidate.language), sourceUrls: candidate.sourceUrls, status: "PREPARED",
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
