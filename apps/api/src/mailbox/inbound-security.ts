export const SECURITY_REVIEW_REASON = "SECURITY_REVIEW";

export type InboundSecuritySignal =
	| "CREDENTIAL_REQUEST"
	| "INTERNAL_DATA_REQUEST"
	| "PAYMENT_CHANGE_REQUEST"
	| "POLICY_BYPASS"
	| "PROMPT_INJECTION"
	| "SUSPICIOUS_ATTACHMENT"
	| "SUSPICIOUS_LINK"
	| "IMPERSONATION";

export type InboundSecurityAssessment = {
	flagged: boolean;
	signals: InboundSecuritySignal[];
};

const SIGNALS: Array<{
	signal: InboundSecuritySignal;
	pattern: RegExp;
}> = [
	{
		signal: "PROMPT_INJECTION",
		pattern:
			/\b(?:ignore|disregard|override|forget)\b.{0,80}\b(?:previous|prior|system|developer|safety|security)\b.{0,40}\b(?:instructions?|rules?|policy|prompt)\b/i,
	},
	{
		signal: "CREDENTIAL_REQUEST",
		pattern:
			/\b(?:passwords?|passcodes?|api\s*keys?|oauth|access\s*tokens?|refresh\s*tokens?|mailbox\s+credentials?|environment\s+variables?|\.env)\b/i,
	},
	{
		signal: "INTERNAL_DATA_REQUEST",
		pattern:
			/\b(?:system\s+prompt|internal\s+(?:prompt|instructions?|config(?:uration)?|infrastructure)|private\s+crm|crm\s+records?|other\s+clients?|client\s+data|private\s+financial|bank(?:ing)?\s+(?:information|details?)|iban|routing\s+number|account\s+number)\b/i,
	},
	{
		signal: "PAYMENT_CHANGE_REQUEST",
		pattern:
			/\b(?:change|update|replace|confirm|send)\b.{0,80}\b(?:bank|iban|routing|payment|wire|beneficiary|invoice)\b/i,
	},
	{
		signal: "POLICY_BYPASS",
		pattern:
			/\b(?:disable|bypass|circumvent|skip|turn\s+off|without)\b.{0,80}\b(?:approval|security|suppression|permission|policy|safeguard|outreach\s+gate|live\s+outreach)\b/i,
	},
	{
		signal: "SUSPICIOUS_LINK",
		pattern: /(?:https?:\/\/|www\.)\S+/i,
	},
];

export function assessInboundSecurity(input: {
	subject: string | null;
	body: string;
	fromEmail: string;
	fromName: string | null;
	trustedDomains: ReadonlySet<string>;
	attachmentCount?: number;
}): InboundSecurityAssessment {
	const text = `${input.subject ?? ""}\n${input.body}`.slice(0, 100_000);
	const signals = SIGNALS.filter(({ pattern }) => pattern.test(text)).map(
		({ signal }) => signal,
	);

	if ((input.attachmentCount ?? 0) > 0) signals.push("SUSPICIOUS_ATTACHMENT");

	const fromDomain = input.fromEmail.split("@").at(-1)?.toLowerCase();
	if (
		fromDomain &&
		!input.trustedDomains.has(fromDomain) &&
		/\b(?:atlas|ihsan|ibl(?:\s+media)?|finance|accounts)\b/i.test(
			input.fromName ?? "",
		)
	) {
		signals.push("IMPERSONATION");
	}

	return {
		flagged: signals.length > 0,
		signals: [...new Set(signals)],
	};
}
