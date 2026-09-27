import type { SQL } from "bun";

export async function claimDue(sql: SQL, worker: string, batchSize: number, leaseSeconds: number) {
	const claimed = await sql<Array<{ id: string; kind: string; priority: number; due_at: Date; attempts: number }>>`
		WITH candidates AS (
			SELECT id
			FROM phase0.work_items
			WHERE due_at <= now()
			  AND completed_at IS NULL
			  AND failed_at IS NULL
			  AND (leased_until IS NULL OR leased_until <= now())
			ORDER BY priority DESC, due_at ASC, id ASC
			FOR UPDATE SKIP LOCKED
			LIMIT ${batchSize}
		)
		UPDATE phase0.work_items w
		SET leased_until = now() + make_interval(secs => ${leaseSeconds}),
			lease_owner = ${worker},
			attempts = attempts + 1
		FROM candidates
		WHERE w.id = candidates.id
		RETURNING w.id::text, w.kind, w.priority, w.due_at, w.attempts
	`;
	return claimed.sort((left, right) => right.priority - left.priority || left.due_at.getTime() - right.due_at.getTime() || left.id.localeCompare(right.id));
}

export async function completeWork(sql: SQL, id: string, worker: string) {
	return sql<Array<{ id: string }>>`
		UPDATE phase0.work_items
		SET completed_at = COALESCE(completed_at, now()), leased_until = NULL
		WHERE id = ${id}::uuid
		  AND lease_owner = ${worker}
		  AND completed_at IS NULL
		RETURNING id::text
	`;
}
