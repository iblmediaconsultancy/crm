type LinkedInActivityLike = {
	subject: string | null;
	body: string | null;
	meta: unknown;
};

function recordMeta(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function isSubstantiveLinkedInActivity(
	activity: LinkedInActivityLike,
): boolean {
	if (!activity.body?.trim()) return false;
	const meta = recordMeta(activity.meta);
	const subject = activity.subject?.trim().toLowerCase() ?? "";
	const channel = meta?.channel;
	const direction = meta?.direction;
	const isLinkedIn = channel === "LINKEDIN" || subject.startsWith("linkedin ");
	if (!isLinkedIn) return false;
	const isConnectionRequest =
		meta?.action === "CONNECTION_REQUEST" ||
		subject.includes("connection request");
	if (isConnectionRequest) {
		if (typeof meta?.note === "string") return meta.note.trim().length > 0;
		if (meta?.noNote === true) return false;
		return !/\bwithout\s+(?:a\s+)?note\b|\bno\s+note\b/i.test(activity.body);
	}
	return (
		direction === "INBOUND" ||
		direction === "OUTBOUND" ||
		subject.includes("linkedin inbound") ||
		subject.includes("linkedin outbound")
	);
}

export function hasSubstantiveLinkedInHistory(
	activities: readonly LinkedInActivityLike[],
): boolean {
	return activities.some(isSubstantiveLinkedInActivity);
}
