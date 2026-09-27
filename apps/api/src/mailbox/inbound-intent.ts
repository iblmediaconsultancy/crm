import type { InboundIntent } from "@crm/db";
import type { InboundSecurityAssessment } from "./inbound-security";

export type InboundIntentDecision = {
	intent: InboundIntent;
	reason: string;
	organizationWide: boolean;
	parked: boolean;
};

const AUTOMATIC_SUBJECT =
	/^\s*(?:automatic reply|auto(?:matic)? reply|autoreply|out of office|ooo)\s*:/i;
const AUTOMATIC_BODY =
	/\b(?:this is an automatic reply|automatic reply|out of office|please expect (?:a )?(?:slight )?delay|responses? (?:may|will) be delayed)\b/i;
const EXPLICIT_NEGATIVE =
	/\b(?:not interested|not looking to pursue (?:a )?collaboration|do not have a need for (?:any )?additional support|don['’]t have a need for (?:any )?additional support|do not need (?:any )?(?:additional )?support|all (?:our|the) players? (?:are|is) covered|already covered at this level|no need for (?:any )?(?:additional )?support|please do not contact|do not contact us|not pursuing (?:a )?collaboration)\b/i;
const LATER_LANGUAGE =
	/\b(?:not now|maybe later|perhaps later|for now|revisit|later in the (?:season|year)|at the moment)\b/i;
const REFERRAL_LANGUAGE =
	/\b(?:please (?:contact|speak|reach out to)|you should (?:contact|speak with)|handled by|forward this to|try (?:contacting|emailing))\b/i;
const POSITIVE_LANGUAGE =
	/\b(?:interested|sounds good|happy to (?:chat|speak|discuss)|let['’]s (?:talk|speak)|would like to|please send (?:more|an overview)|open to (?:a )?(?:conversation|call|discussion)|schedule a (?:call|conversation))\b/i;

export function classifyInboundIntent(input: {
	subject: string | null;
	body: string;
	fromName: string | null;
	securityReview: InboundSecurityAssessment;
}): InboundIntentDecision {
	if (input.securityReview.flagged) {
		return {
			intent: "SECURITY_REVIEW",
			reason: "Inbound security indicators require manual review.",
			organizationWide: false,
			parked: false,
		};
	}

	const text = replyTopText(`${input.subject ?? ""}\n${input.body}`);
	if (
		AUTOMATIC_SUBJECT.test(input.subject ?? "") ||
		AUTOMATIC_BODY.test(text)
	) {
		return {
			intent: "AUTO_REPLY",
			reason: "Automatic acknowledgement or delayed-response notice.",
			organizationWide: false,
			parked: false,
		};
	}

	const negative = EXPLICIT_NEGATIVE.test(text);
	if (negative) {
		return {
			intent: "HUMAN_NEGATIVE",
			reason: "Explicit negative response to cold outreach.",
			organizationWide:
				/\b(?:all (?:our|the) players?|our roster|additional support|we (?:do not|don['’]t|are not|aren['’]t))\b/i.test(
					text,
				) ||
				/\b(?:team|agency|management|football|soccer|gmbh)\b/i.test(
					input.fromName ?? "",
				),
			parked: false,
		};
	}

	if (LATER_LANGUAGE.test(text)) {
		return {
			intent: "HUMAN_NEUTRAL",
			reason: "The reply defers rather than rejecting future contact.",
			organizationWide: false,
			parked: true,
		};
	}

	if (REFERRAL_LANGUAGE.test(text)) {
		return {
			intent: "REFERRAL_OR_ROUTING",
			reason: "The reply routes the conversation to another person or channel.",
			organizationWide: false,
			parked: false,
		};
	}

	if (POSITIVE_LANGUAGE.test(text)) {
		return {
			intent: "HUMAN_POSITIVE",
			reason: "The reply expresses interest in continuing the conversation.",
			organizationWide: false,
			parked: false,
		};
	}

	return {
		intent: "HUMAN_NEUTRAL",
		reason: "Human reply received without a clear positive or negative intent.",
		organizationWide: false,
		parked: false,
	};
}

export function isHumanReplyIntent(intent: InboundIntent): boolean {
	return (
		intent === "HUMAN_POSITIVE" ||
		intent === "HUMAN_NEUTRAL" ||
		intent === "HUMAN_NEGATIVE" ||
		intent === "REFERRAL_OR_ROUTING"
	);
}

export function replyTopText(value: string): string {
	const lines: string[] = [];
	for (const line of value.split(/\r?\n/)) {
		if (/^\s*>/.test(line)) continue;
		if (/^\s*(?:-----Original Message-----|(?:from|von|de):)\s*/i.test(line))
			break;
		if (/^\s*on .+ wrote:\s*$/i.test(line)) break;
		lines.push(line);
	}
	return lines.join("\n").trim();
}
