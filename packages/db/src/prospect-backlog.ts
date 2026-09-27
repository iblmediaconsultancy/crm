type MailboxTypeValue = "PERSONAL" | "ROLE" | "GENERAL" | "UNKNOWN";
type RouteUsageValue = "CONTACT_ONCE" | "REUSABLE";
type HookTypeValue =
	| "CURRENT_EVENT"
	| "MEDIA_GAP"
	| "FIRST_TEAM_BREAKTHROUGH"
	| "INTERNATIONAL_VISIBILITY"
	| "EMERGING_TALENT"
	| "NEW_SEASON_ROLE_MARKET"
	| "ROSTER_MEDIA_GAP"
	| "EXISTING_RELATIONSHIP"
	| "OTHER_SPECIFIC_OPPORTUNITY";

const roleMailboxes = new Set([
	"academy",
	"agent",
	"agentes",
	"baseinfo",
	"brazil",
	"commercial",
	"comunicacion",
	"comunicaciones",
	"football",
	"futbol",
	"futebol",
	"infofootball",
	"marketing",
	"media",
	"partnerships",
	"press",
	"sales",
	"scout",
	"soccer",
]);

const generalMailboxes = new Set([
	"admin",
	"administracion",
	"administracao",
	"agence",
	"contact",
	"contacto",
	"contactus",
	"contato",
	"email",
	"enquiries",
	"general",
	"geral",
	"gerencia",
	"hello",
	"info",
	"inquiries",
	"inquiry",
	"mail",
	"management",
	"office",
	"post",
	"support",
	"team",
	"inbox",
	"welcome",
]);

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

const genericAgencyTokens = new Set([
	"agency",
	"football",
	"management",
	"sports",
	"sport",
	"soccer",
	"starmakers",
	"talent",
]);

function normalizedTokens(value: string): string[] {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length >= 2);
}

function domainBase(domain: string): string {
	const labels = domain.toLowerCase().split(".").filter(Boolean);
	return labels.length > 1
		? (labels.at(-2) ?? labels[0] ?? "")
		: (labels[0] ?? "");
}

function hasNameEvidence(
	localPart: string,
	domain: string,
	entityNames: string[],
): boolean {
	const localTokens = normalizedTokens(localPart);
	const domainLabel = domainBase(domain);
	const domainTokens = normalizedTokens(domainLabel);
	const nameTokens = entityNames
		.flatMap(normalizedTokens)
		.filter((token) => token.length >= 3);
	const localMatchesName = localTokens.some((token) =>
		nameTokens.includes(token),
	);
	const domainMatchesName =
		domainTokens.some((token) => nameTokens.includes(token)) ||
		nameTokens.some((token) => domainLabel.includes(token));
	return localMatchesName && domainMatchesName;
}

export function classifyProspectBacklogRoute(input: {
	type: string;
	value: string;
	linkedEntityKeys?: string[];
	entityNames?: string[];
	routeLabel?: string | null;
}): {
	mailboxType: MailboxTypeValue;
	mailboxTypeEvidence: string;
	routeUsage: RouteUsageValue;
} {
	const routeUsage =
		(input.linkedEntityKeys?.length ?? 0) > 1 ? "CONTACT_ONCE" : "REUSABLE";
	if (input.type !== "EMAIL") {
		return {
			mailboxType: "UNKNOWN",
			mailboxTypeEvidence: "Non-email route; mailbox type does not apply.",
			routeUsage,
		};
	}

	const [localPart, domain = ""] = input.value
		.trim()
		.toLowerCase()
		.split("@", 2);
	const local = localPart ?? "";
	const domainName = domainBase(domain);
	const localTokens = normalizedTokens(local);
	const entityNames = input.entityNames ?? [];

	if (
		roleMailboxes.has(local) ||
		localTokens.some((token) => roleMailboxes.has(token))
	) {
		return {
			mailboxType: "ROLE",
			mailboxTypeEvidence: `Role mailbox local part: ${local}.`,
			routeUsage,
		};
	}

	if (
		generalMailboxes.has(local) ||
		localTokens.some((token) => generalMailboxes.has(token))
	) {
		return {
			mailboxType: "GENERAL",
			mailboxTypeEvidence: `Generic agency/team mailbox local part: ${local}.`,
			routeUsage,
		};
	}

	if (domainName && local === domainName) {
		return {
			mailboxType: "GENERAL",
			mailboxTypeEvidence: "Mailbox local part matches the agency domain name.",
			routeUsage,
		};
	}

	if (hasNameEvidence(local, domain, entityNames)) {
		const labelEvidence = input.routeLabel
			?.toLowerCase()
			.includes("professional")
			? "Published professional route with person and domain-name evidence."
			: "Person and domain-name evidence align for a named route.";
		return {
			mailboxType: "PERSONAL",
			mailboxTypeEvidence: labelEvidence,
			routeUsage,
		};
	}

	if (
		freeMailDomains.has(domain) &&
		(localTokens.some((token) => genericAgencyTokens.has(token)) ||
			/(agency|management|sports|football|soccer|talent|starmakers)/.test(
				local,
			))
	) {
		return {
			mailboxType: "GENERAL",
			mailboxTypeEvidence: `Free-mail domain with agency-branded local part: ${local}.`,
			routeUsage,
		};
	}

	return {
		mailboxType: "UNKNOWN",
		mailboxTypeEvidence:
			"No sufficient evidence to identify the mailbox owner or function.",
		routeUsage,
	};
}

const supportedOutreachLanguages = new Set(["English", "Dutch", "Turkish"]);
const supportedHookTypes = new Set<HookTypeValue>([
	"CURRENT_EVENT",
	"MEDIA_GAP",
	"FIRST_TEAM_BREAKTHROUGH",
	"INTERNATIONAL_VISIBILITY",
	"EMERGING_TALENT",
	"NEW_SEASON_ROLE_MARKET",
	"ROSTER_MEDIA_GAP",
	"EXISTING_RELATIONSHIP",
	"OTHER_SPECIFIC_OPPORTUNITY",
]);

const forbiddenExternalCopyCharacters = new Map([
	["\u2014", "em dash"],
	["\u2013", "en dash"],
]);

export function findForbiddenExternalCopyCharacters(
	values: Array<string | null | undefined>,
): string[] {
	const found = new Set<string>();
	for (const value of values) {
		if (!value) continue;
		for (const [character, label] of forbiddenExternalCopyCharacters) {
			if (value.includes(character)) found.add(label);
		}
	}
	return [...found];
}

export function sanitizeExternalCopy(value: string): string {
	return value.replace(/\s*\u2014\s*/g, ": ").replace(/\s*\u2013\s*/g, " - ");
}

function validateProspectCopy(input: {
	subject?: string | null;
	body?: string | null;
	followUpApproach?: string | null;
}): { valid: true } | { valid: false; reason: string } {
	const forbidden = findForbiddenExternalCopyCharacters([
		input.subject,
		input.body,
		input.followUpApproach,
	]);
	if (forbidden.length > 0) {
		return {
			valid: false,
			reason: `External copy contains forbidden punctuation: ${forbidden.join(", ")}.`,
		};
	}
	return { valid: true };
}

export function validatePreparedOutreach(input: {
	language: string;
	hookType: HookTypeValue;
	whyNow: string;
	researchSummary: string;
	sourceUrls: string[];
	subject: string;
	body: string;
	followUpApproach: string;
}): { valid: true } | { valid: false; reason: string } {
	if (!supportedOutreachLanguages.has(input.language)) {
		return {
			valid: false,
			reason: "Language is outside the approved Atlas outreach set.",
		};
	}
	if (!supportedHookTypes.has(input.hookType)) {
		return { valid: false, reason: "Hook type is not supported." };
	}
	if (input.whyNow.trim().length < 50) {
		return {
			valid: false,
			reason: "Why-now reasoning is not specific enough.",
		};
	}
	if (input.researchSummary.trim().length < 50) {
		return {
			valid: false,
			reason: "Research evidence is not detailed enough.",
		};
	}
	if (input.sourceUrls.length === 0) {
		return {
			valid: false,
			reason: "At least one research source is required.",
		};
	}
	return validateProspectCopy(input);
}

function hasGenericPlayerPlaceholder(value: string): boolean {
	return (
		/\b(?:a|some|any)\s+(?:current\s+)?(?:[a-z0-9&/]+\s+)*roster player\b/i.test(
			value,
		) || /to be nominated by the team/i.test(value)
	);
}

function hasBlockedCommercialLanguage(values: string[]): boolean {
	return values.some((value) =>
		/\b(?:fee|fees|price|prices|pricing|cost|costs|budget|budgets|discount|discounts|rate|rates|package|packages|quote|quotes|proposal|proposals)\b|(?:€|\$|£)\s?\d{2,}|\b\d[\d,.]*\s*(?:per\s+month|\/\s*month)\b/i.test(
			value,
		),
	);
}

export function validateReadyProspect(input: {
	language: string;
	hookType: HookTypeValue;
	whyNow: string;
	researchSummary: string;
	sourceUrls: string[];
	subject: string;
	body: string;
	followUpApproach: string;
	playerEntryPoint?: string | null;
	routeConfidence?: string | null;
	researchConfidence?: string | null;
	mailboxType?: MailboxTypeValue | null;
	routeUsage?: RouteUsageValue | null;
	existingContactRoute?: boolean;
	activeLead?: boolean;
	existingThread?: boolean;
	suppressed?: boolean;
	protectedPlayer?: boolean;
	existingRelationship?: boolean;
}): { valid: true } | { valid: false; reasons: string[] } {
	const reasons: string[] = [];
	const prepared = validatePreparedOutreach(input);
	if (!prepared.valid) reasons.push(prepared.reason);
	if (!input.playerEntryPoint?.trim()) {
		reasons.push("A concrete player or agency opportunity is required.");
	} else if (hasGenericPlayerPlaceholder(input.playerEntryPoint)) {
		reasons.push("The player opportunity is a generic placeholder.");
	}
	if (input.routeConfidence !== "HIGH") {
		reasons.push("Route confidence must be HIGH before READY.");
	}
	if (input.researchConfidence !== "HIGH") {
		reasons.push("Research confidence must be HIGH before READY.");
	}
	if (!input.mailboxType || input.mailboxType === "UNKNOWN") {
		reasons.push("Mailbox type must be identified before READY.");
	}
	if (!input.routeUsage) {
		reasons.push("Route usage must be classified before READY.");
	}
	if (input.existingContactRoute) {
		reasons.push("An existing CRM contact route blocks new READY outreach.");
	}
	if (input.activeLead) {
		reasons.push("An active Lead already exists for this route.");
	}
	if (input.existingThread) {
		reasons.push("An existing email thread blocks new READY outreach.");
	}
	if (input.suppressed) reasons.push("The contact or domain is suppressed.");
	if (input.protectedPlayer)
		reasons.push("The player is protected from cold outreach.");
	if (input.existingRelationship) {
		reasons.push("An existing relationship requires Ihsan review.");
	}
	if (
		hasBlockedCommercialLanguage([
			input.subject,
			input.body,
			input.followUpApproach,
		])
	) {
		reasons.push("External copy contains pricing or commercial language.");
	}
	return reasons.length === 0 ? { valid: true } : { valid: false, reasons };
}
