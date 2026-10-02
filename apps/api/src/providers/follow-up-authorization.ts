export type FollowUpAuthorizationDisposition = "READY" | "WAIT" | "CANCEL";

export function followUpAuthorizationDisposition(input: {
	manuallyApproved: boolean;
	coldDraft: boolean;
	mailboxAllowed: boolean;
	hasAuthorizationEvidence: boolean;
	authorizationValid: boolean;
	liveOutreachEnabled: boolean;
}): FollowUpAuthorizationDisposition {
	if (input.manuallyApproved) return "READY";
	if (!input.coldDraft || !input.mailboxAllowed) return "CANCEL";
	if (
		!input.hasAuthorizationEvidence ||
		!input.authorizationValid ||
		!input.liveOutreachEnabled
	)
		return "WAIT";
	return "READY";
}
