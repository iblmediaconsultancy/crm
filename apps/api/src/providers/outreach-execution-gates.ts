import { followUpAuthorizationDisposition } from "./follow-up-authorization";

export function atlasLiveOutreachEnvironmentEnabled() {
	return (
		process.env.ATLAS_LIVE_OUTREACH_ENABLED?.trim().toLowerCase() === "true"
	);
}

export function atlasScheduledExecutionEnabled() {
	return (
		process.env.ATLAS_SCHEDULED_EXECUTION_ENABLED?.trim().toLowerCase() ===
		"true"
	);
}

export function followUpClaimAllowed(input: {
	manuallyApproved: boolean;
	coldDraft: boolean;
	mailboxAllowed: boolean;
	hasAuthorizationEvidence: boolean;
	authorizationValid: boolean;
	liveOutreachEnabled: boolean;
	scheduledExecutionEnabled: boolean;
	providerReady: boolean;
	cohortBound: boolean;
}) {
	if (!input.providerReady) return false;
	if (input.manuallyApproved) return true;
	if (!input.scheduledExecutionEnabled || !input.liveOutreachEnabled)
		return false;
	if (
		input.coldDraft &&
		(!input.hasAuthorizationEvidence ||
			!input.authorizationValid ||
			!input.cohortBound)
	)
		return false;
	return followUpAuthorizationDisposition(input) !== "WAIT";
}
