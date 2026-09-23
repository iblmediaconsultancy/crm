export type LinkedInBrowserAction = {
	jobId: string;
	conversationId: string;
	action: "MESSAGE" | "CONNECTION_REQUEST";
	body?: string;
	browserSessionKey: string;
};

export type LinkedInBrowserOutcome =
	| {
			status: "CONFIRMED";
			externalMessageKey?: string | null;
			observedAt: Date;
	  }
	| {
			status: "AMBIGUOUS";
			errorCode:
				| "CAPTCHA"
				| "ACCOUNT_VERIFICATION"
				| "LINKEDIN_WARNING"
				| "SECURITY_CHALLENGE"
				| "RESTRICTION"
				| "SEND_STATE_UNCLEAR";
			observedAt: Date;
	  }
	| {
			status: "FAILED";
			errorCode: string;
			observedAt: Date;
	  };

export interface LinkedInBrowserAdapter {
	execute(action: LinkedInBrowserAction): Promise<LinkedInBrowserOutcome>;
}

export function isManualReviewOutcome(
	outcome: LinkedInBrowserOutcome,
): boolean {
	return outcome.status === "AMBIGUOUS";
}
