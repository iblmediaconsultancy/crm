export type FollowUpCandidateEvaluation = {
	id: string;
	evaluation: {
		eligible: boolean;
		reason: string | null;
		canonicalDueAt: Date | null;
	};
};

export type FollowUpCandidateState = {
	id: string;
	status: string;
	dueAt: Date;
	retryAt: Date | null;
	leasedUntil: Date | null;
	attemptCount: number;
	maxAttempts: number;
	plan: { status: string; channel: string };
};

export function selectPreparedFollowUpMembers(
	evaluated: readonly FollowUpCandidateEvaluation[],
	currentSteps: readonly FollowUpCandidateState[],
	assignedIds: ReadonlySet<string>,
	now: Date,
) {
	const currentById = new Map(currentSteps.map((step) => [step.id, step]));
	const members: Array<{ followUpStepId: string; canonicalDueAt: Date }> = [];
	const excluded: Array<{ followUpStepId: string; reason: string }> = [];
	for (const candidate of evaluated) {
		const { evaluation, id } = candidate;
		if (!evaluation.eligible || !evaluation.canonicalDueAt) {
			excluded.push({
				followUpStepId: id,
				reason: evaluation.reason ?? "FOLLOW_UP_PREFLIGHT_FAILED",
			});
			continue;
		}
		if (assignedIds.has(id)) {
			excluded.push({
				followUpStepId: id,
				reason: "EXISTING_EXECUTABLE_COHORT",
			});
			continue;
		}
		const current = currentById.get(id);
		if (
			current?.status !== "PENDING" ||
			current.dueAt > now ||
			(current.retryAt && current.retryAt > now) ||
			(current.leasedUntil && current.leasedUntil > now) ||
			current.attemptCount >= current.maxAttempts ||
			current.plan.status !== "ACTIVE" ||
			current.plan.channel !== "EMAIL"
		) {
			excluded.push({
				followUpStepId: id,
				reason: "FOLLOW_UP_STATE_CHANGED_DURING_PREPARATION",
			});
			continue;
		}
		members.push({
			followUpStepId: id,
			canonicalDueAt: evaluation.canonicalDueAt,
		});
	}
	return { members, excluded };
}

export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	map: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (!Number.isInteger(concurrency) || concurrency < 1)
		throw new RangeError("Concurrency must be a positive integer.");
	const results = new Array<R>(items.length);
	const indexedItems = items.map((item, index) => ({ item, index }));
	let nextIndex = 0;
	const workerCount = Math.min(concurrency, items.length);
	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (true) {
				const index = nextIndex;
				if (index >= items.length) return;
				nextIndex += 1;
				const current = indexedItems[index];
				if (current)
					results[current.index] = await map(current.item, current.index);
			}
		}),
	);
	return results;
}
