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
	"baseinfo",
	"brazil",
	"commercial",
	"football",
	"infofootball",
	"marketing",
	"media",
	"partnerships",
	"press",
	"sales",
]);

const generalMailboxes = new Set([
	"admin",
	"contact",
	"enquiries",
	"general",
	"hello",
	"info",
	"mail",
	"management",
	"office",
	"support",
	"team",
	"inbox",
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

export function validatePreparedOutreach(input: {
	language: string;
	hookType: HookTypeValue;
	whyNow: string;
	researchSummary: string;
	sourceUrls: string[];
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
	return { valid: true };
}
