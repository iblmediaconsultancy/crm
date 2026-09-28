export type ConsumedLinkedInFirstTouchEvidence = {
	claimChannel: string | null | undefined;
	claimStatus: string | null | undefined;
	claimIdempotencyKey?: string | null | undefined;
	connectionRequest:
		| {
				action: string;
				status: string;
				actionPayload: unknown;
		  }
		| null
		| undefined;
	messageJobExists: boolean;
	historicalConnectionRequestActivities?: readonly LinkedInConnectionRequestActivity[];
};

export type LinkedInConnectionRequestActivity = {
	subject: string | null;
	body: string | null;
	meta: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function hasSubstantiveLinkedInConnectionNote(
	actionPayload: unknown,
): boolean {
	const payload = record(actionPayload);
	if (payload?.noNote !== true) return true;
	const note = payload.note;
	return typeof note === "string" && note.trim().length > 0;
}

export function canReuseConsumedLinkedInConnectionClaim(
	evidence: ConsumedLinkedInFirstTouchEvidence,
): boolean {
	const request = evidence.connectionRequest;
	const historicalNoNoteRequest =
		evidence.historicalConnectionRequestActivities?.some(
			(activity) =>
				activity.subject?.toLocaleLowerCase().includes("connection request") &&
				activity.body?.toLocaleLowerCase().includes("without a note") &&
				(() => {
					const meta = record(activity.meta);
					return (
						meta?.channel === "LINKEDIN" &&
						meta.action === "CONNECTION_REQUEST" &&
						meta.status === "BROWSER_CONFIRMED_PENDING" &&
						meta.idempotencyKey === evidence.claimIdempotencyKey
					);
				})(),
		);
	return Boolean(
		evidence.claimChannel === "LINKEDIN" &&
			evidence.claimStatus === "CONSUMED" &&
			((request?.action === "CONNECTION_REQUEST" &&
				request.status === "SUCCEEDED" &&
				!hasSubstantiveLinkedInConnectionNote(request.actionPayload)) ||
				historicalNoNoteRequest) &&
			!evidence.messageJobExists,
	);
}
