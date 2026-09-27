export type LinkedInInboxClassification =
	| "ACTION_REQUIRED"
	| "REFERRAL_OR_PLAYER_OPPORTUNITY"
	| "WARM_HANDOFF"
	| "WAITING_ON_PROSPECT"
	| "POSITIVE_LIGHT"
	| "PARKED_NO_CURRENT_NEED"
	| "CLOSED_OR_DO_NOT_PUSH"
	| "AMBIGUOUS_OR_NEEDS_IHSAN";

export type LinkedInInboxMessage = {
	body: string;
	direction: "INBOUND" | "OUTBOUND";
};

const globalRejectionPattern =
	/\b(?:do not|don't|do not ever|never)\s+(?:contact|message|reach out)\b|\bstop\s+(?:contacting|messaging|reaching out)\b|\bremove me\b/i;
const channelRejectionPattern =
	/\b(?:not interested|not a fit|no need|already have someone|nothing needed|not looking for)\b/i;
const parkedPattern =
	/\b(?:not now|maybe later|at the moment|currently|this season|come back later|busy right now)\b/i;
const handoffPattern =
	/\b(?:whatsapp|phone|email me|send me your number|move (?:this|the conversation) (?:to|off)|talk by phone)\b/i;
const referralPattern =
	/\b(?:player|talent|roster|academy|club|scout|refer|referral|recommend|someone who)\b/i;
const actionPattern =
	/\?|\b(?:interested|let's talk|lets talk|schedule|book|send details|send more|how does it work|what do you need|can you|could you|would you|shall we|next step|happy to discuss|open to)\b/i;
const positivePattern =
	/\b(?:thanks|thank you|appreciate it|nice to connect|great to connect|sounds good|great|perfect|likewise)\b/i;

export function classifyLinkedInInboxMessage(
	message: LinkedInInboxMessage,
): LinkedInInboxClassification {
	const body = message.body.trim();
	if (!body) return "AMBIGUOUS_OR_NEEDS_IHSAN";
	if (globalRejectionPattern.test(body)) return "CLOSED_OR_DO_NOT_PUSH";
	if (message.direction === "OUTBOUND") return "WAITING_ON_PROSPECT";
	if (parkedPattern.test(body)) return "PARKED_NO_CURRENT_NEED";
	if (channelRejectionPattern.test(body)) return "CLOSED_OR_DO_NOT_PUSH";
	if (referralPattern.test(body)) return "REFERRAL_OR_PLAYER_OPPORTUNITY";
	if (handoffPattern.test(body)) return "WARM_HANDOFF";
	if (actionPattern.test(body)) return "ACTION_REQUIRED";
	if (positivePattern.test(body)) return "POSITIVE_LIGHT";
	return "AMBIGUOUS_OR_NEEDS_IHSAN";
}
