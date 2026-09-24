import { COMMERCIAL_ENRICHMENT_MAX_ATTEMPTS, db, Prisma } from "@crm/db";
import { MAX_ATTEMPTS, RETIRED_OUTCOME } from "@crm/db/agent-tasks";

export type LeasedTask = {
	id: string;
	leadId: string | null;
	contactId: string | null;
	companyId: string | null;
	kind: string;
	reason: string;
	budget: number;
	attempts: number;
	priority: number;
	dueAt: Date;
};

export type TaskSubject = {
	id: string;
	leadId: string | null;
	contactId: string | null;
	companyId: string | null;
	kind: string;
};

const LEASE_MS = 10 * 60_000;

export { DIRECT_KINDS, MAX_ATTEMPTS } from "@crm/db/agent-tasks";

export async function claimDue(
	limit: number,
	kinds: { only: readonly string[] } | { except: readonly string[] },
	leaseMs = LEASE_MS,
): Promise<LeasedTask[]> {
	const now = new Date();
	const until = new Date(now.getTime() + leaseMs);

	const list = "only" in kinds ? kinds.only : kinds.except;
	if ("only" in kinds && list.length === 0) return [];

	const match = Prisma.sql`t2.kind ${"only" in kinds ? Prisma.sql`IN` : Prisma.sql`NOT IN`} (${Prisma.join(list)})`;

	const claimed = await db.$queryRaw<LeasedTask[]>`
		UPDATE "agentTask" AS t
		SET "leasedUntil" = ${until},
			"startedAt" = COALESCE(t."startedAt", ${now}),
			"attempts" = t."attempts" + 1
		FROM (
			SELECT t2.id FROM "agentTask" AS t2
			WHERE t2."lifecycleState" = 'ACTIVE'
				AND t2."finishedAt" IS NULL
				AND t2."dueAt" <= ${now}
				AND (t2."leasedUntil" IS NULL OR t2."leasedUntil" < ${now})
				AND t2."attempts" < ${MAX_ATTEMPTS}
				AND ${match}
			ORDER BY t2."priority" DESC, t2."dueAt" ASC
			LIMIT ${limit}
			FOR UPDATE SKIP LOCKED
		) AS due
		WHERE t.id = due.id
		RETURNING t.id, t."leadId", t."contactId", t."companyId", t.kind, t.reason,
			t.budget, t.attempts, t.priority, t."dueAt";
	`;
	const enrichmentLeadIds = claimed
		.filter(
			(task) => task.kind === "atlas-commercial-enrichment" && task.leadId,
		)
		.map((task) => task.leadId as string);
	if (enrichmentLeadIds.length > 0) {
		await db.lead.updateMany({
			where: {
				id: { in: enrichmentLeadIds },
				commercialEnrichmentAttempts: {
					lt: COMMERCIAL_ENRICHMENT_MAX_ATTEMPTS,
				},
			},
			data: { commercialEnrichmentAttempts: { increment: 1 } },
		});
	}

	return claimed.sort(
		(a, b) => b.priority - a.priority || a.dueAt.getTime() - b.dueAt.getTime(),
	);
}

export async function retireExhausted(): Promise<TaskSubject[]> {
	const now = new Date();

	return db.$queryRaw<TaskSubject[]>`
		UPDATE "agentTask" AS t
		SET "finishedAt" = ${now},
			"outcome" = ${RETIRED_OUTCOME}
		WHERE t."finishedAt" IS NULL
			AND t."lifecycleState" = 'ACTIVE'
			AND t."attempts" >= ${MAX_ATTEMPTS}
			AND (t."leasedUntil" IS NULL OR t."leasedUntil" < ${now})
		RETURNING t.id, t."leadId", t."contactId", t."companyId", t.kind;
	`;
}

export async function completeTask(
	taskId: string,
	outcome: string,
	sessionId?: string,
): Promise<TaskSubject | null> {
	const { count } = await db.agentTask.updateMany({
		where: { id: taskId, lifecycleState: "ACTIVE", finishedAt: null },
		data: {
			finishedAt: new Date(),
			outcome: outcome.slice(0, 500),
			...(sessionId ? { sessionId } : {}),
		},
	});

	if (count === 0) return null;

	const subject = await db.agentTask.findUnique({
		where: { id: taskId },
		select: {
			id: true,
			leadId: true,
			contactId: true,
			companyId: true,
			kind: true,
		},
	});
	if (subject?.kind === "atlas-commercial-enrichment" && subject.leadId) {
		const lead = await db.lead.findUnique({
			where: { id: subject.leadId },
			select: {
				commercialEnrichmentStatus: true,
				commercialEnrichmentAttempts: true,
			},
		});
		if (lead?.commercialEnrichmentStatus === "QUEUED") {
			await db.lead.update({
				where: { id: subject.leadId },
				data: {
					commercialEnrichmentStatus:
						lead.commercialEnrichmentAttempts >=
						COMMERCIAL_ENRICHMENT_MAX_ATTEMPTS
							? "EXHAUSTED"
							: "QUEUED",
					commercialEnrichmentNextAttemptAt:
						lead.commercialEnrichmentAttempts >=
						COMMERCIAL_ENRICHMENT_MAX_ATTEMPTS
							? null
							: new Date(
									Date.now() + lead.commercialEnrichmentAttempts * 15 * 60_000,
								),
				},
			});
		}
	}

	return subject;
}

export async function taskSubject(taskId: string): Promise<TaskSubject | null> {
	return db.agentTask.findUnique({
		where: { id: taskId },
		select: {
			id: true,
			leadId: true,
			contactId: true,
			companyId: true,
			kind: true,
		},
	});
}

export async function noteSession(
	taskId: string,
	sessionId: string,
): Promise<void> {
	await db.agentTask.updateMany({
		where: { id: taskId, lifecycleState: "ACTIVE", finishedAt: null },
		data: { sessionId },
	});
}

export async function scheduleTask(input: {
	leadId?: string | null;
	contactId?: string | null;
	companyId?: string | null;
	kind: string;
	reason: string;
	dueAt: Date;
	priority?: number;
	budget?: number;
}): Promise<{ id: string }> {
	const existing = await db.agentTask.findFirst({
		where: {
			kind: input.kind,
			lifecycleState: "ACTIVE",
			finishedAt: null,
			leadId: input.leadId ?? undefined,
			contactId: input.contactId ?? undefined,
			companyId: input.companyId ?? undefined,
		},
		select: { id: true },
	});

	if (existing) {
		await db.agentTask.update({
			where: { id: existing.id },
			data: { dueAt: input.dueAt, reason: input.reason },
		});
		return existing;
	}

	return db.agentTask.create({
		data: {
			leadId: input.leadId ?? null,
			contactId: input.contactId ?? null,
			companyId: input.companyId ?? null,
			kind: input.kind,
			reason: input.reason,
			dueAt: input.dueAt,
			priority: input.priority ?? 0,
			budget: input.budget ?? 4,
		},
		select: { id: true },
	});
}

export async function lastDecision(contactId: string) {
	return db.agentTask.findFirst({
		where: { contactId },
		orderBy: { createdAt: "desc" },
		select: {
			kind: true,
			reason: true,
			dueAt: true,
			finishedAt: true,
			outcome: true,
		},
	});
}

export type { Prisma };
