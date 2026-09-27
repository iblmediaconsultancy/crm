import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pg from "pg";

const adminUrl = process.env.RLS_ADMIN_DATABASE_URL;
const workerUrl = process.env.RLS_WORKER_DATABASE_URL;
const suite = adminUrl && workerUrl ? describe : describe.skip;
const suffix = process.env.TEST_RUN_ID ?? "worker-rls";
const userId = `worker-user-${suffix}`;
const companyId = `worker-company-${suffix}`;
const policyId = `worker-policy-${suffix}`;
const requestId = `worker-request-${suffix}`;
const { Client } = pg;
let admin: pg.Client;
let worker: pg.Client;

async function workerPrincipal<T>(run: () => Promise<T>): Promise<T> {
	await worker.query("BEGIN");
	try {
		await worker.query("SELECT set_config('ibl.user_id', '', true)");
		await worker.query("SELECT set_config('ibl.mailbox_id', '', true)");
		await worker.query(
			"SELECT set_config('ibl.principal_kind', 'worker', true)",
		);
		const result = await run();
		await worker.query("COMMIT");
		return result;
	} catch (error) {
		await worker.query("ROLLBACK");
		throw error;
	}
}

suite("least-privilege PostgreSQL worker RLS", () => {
	beforeAll(async () => {
		admin = new Client({ connectionString: adminUrl });
		worker = new Client({ connectionString: workerUrl });
		await admin.connect();
		await worker.connect();
		await admin.query(
			"INSERT INTO \"organization\" (id,name,slug,\"createdAt\") VALUES ('workspace','IBL','ibl',NOW()) ON CONFLICT (id) DO NOTHING",
		);
		await admin.query(
			'INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$1,$2,true,NOW(),NOW()) ON CONFLICT (id) DO NOTHING',
			[userId, `${userId}@example.test`],
		);
		await admin.query(
			'INSERT INTO "userProfile" ("userId",status,"workingPreferences","createdAt","updatedAt") VALUES ($1,\'ACTIVE\',\'{"allocation":{"capacity":2}}\'::jsonb,NOW(),NOW()) ON CONFLICT ("userId") DO UPDATE SET status=\'ACTIVE\'',
			[userId],
		);
		await admin.query(
			'INSERT INTO "member" (id,"organizationId","userId",role,"createdAt") VALUES ($1,\'workspace\',$2,\'team\',NOW()) ON CONFLICT ("organizationId","userId") DO UPDATE SET role=EXCLUDED.role',
			[`member-${userId}`, userId],
		);
		await admin.query(
			'INSERT INTO "company" (id,name,"ownerId","createdAt","updatedAt") VALUES ($1,\'Worker target\',$2,NOW(),NOW()) ON CONFLICT (id) DO NOTHING',
			[companyId, userId],
		);
		await admin.query(
			'INSERT INTO "allocationPolicy" (id,version,name,active,rules,"createdByUserId","createdAt","activatedAt") VALUES ($1,991001,\'Worker test\',true,\'{"defaultCapacity":2}\'::jsonb,$2,NOW(),NOW()) ON CONFLICT (id) DO NOTHING',
			[policyId, userId],
		);
		await admin.query(
			'INSERT INTO "allocationRequest" (id,"entityType","entityId",status,"idempotencyKey","maxAttempts","createdAt","updatedAt") VALUES ($1,\'COMPANY\',$2,\'PENDING\',$3,5,NOW(),NOW()) ON CONFLICT (id) DO NOTHING',
			[requestId, companyId, `worker-allocation:${suffix}`],
		);
	});

	afterAll(async () => {
		await admin.query('DELETE FROM "assignment" WHERE "entityId"=$1', [
			companyId,
		]);
		await admin.query('DELETE FROM "allocationRequest" WHERE id=$1', [
			requestId,
		]);
		await admin.query('DELETE FROM "allocationPolicy" WHERE id=$1', [policyId]);
		await admin.query('DELETE FROM "company" WHERE id=$1', [companyId]);
		await admin.query('DELETE FROM "member" WHERE "userId"=$1', [userId]);
		await admin.query('DELETE FROM "user" WHERE id=$1', [userId]);
		await Promise.all([worker.end(), admin.end()]);
	});

	test("worker can claim, evaluate, and finalize allocation through RLS", async () => {
		await workerPrincipal(async () => {
			const claimed = await worker.query(
				'UPDATE "allocationRequest" SET status=\'LEASED\',"leaseOwner"=\'spec-worker\',"leasedUntil"=NOW()+INTERVAL \'60 seconds\',"attemptCount"="attemptCount"+1 WHERE id=(SELECT id FROM "allocationRequest" WHERE status=\'PENDING\' FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id',
			);
			expect(claimed.rows[0]?.id).toBe(requestId);
			expect(
				(
					await worker.query('SELECT id FROM "allocationPolicy" WHERE id=$1', [
						policyId,
					])
				).rowCount,
			).toBe(1);
			expect(
				(
					await worker.query('SELECT id FROM "company" WHERE id=$1', [
						companyId,
					])
				).rowCount,
			).toBe(1);
			expect(
				(
					await worker.query(
						'SELECT "userId" FROM "member" WHERE "userId"=$1',
						[userId],
					)
				).rowCount,
			).toBe(1);
			await worker.query(
				'INSERT INTO "assignment" (id,"entityType","entityId","assigneeUserId",reason,"assignedAt") VALUES ($1,\'COMPANY\',$2,$3,\'policy test\',NOW())',
				[`assignment-${suffix}`, companyId, userId],
			);
			const finalized = await worker.query(
				'UPDATE "allocationRequest" SET status=\'ALLOCATED\',"assigneeUserId"=$1,"leaseOwner"=NULL,"leasedUntil"=NULL WHERE id=$2 AND "leaseOwner"=\'spec-worker\'',
				[userId, requestId],
			);
			expect(finalized.rowCount).toBe(1);
		});
	});

	test("worker cannot mutate canonical CRM rows", async () => {
		await expect(
			workerPrincipal(() =>
				worker.query("UPDATE \"company\" SET name='forbidden' WHERE id=$1", [
					companyId,
				]),
			),
		).rejects.toThrow();
	});
});
