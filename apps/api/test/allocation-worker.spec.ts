import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@crm/db";
import pg from "pg";
import { AllocationService } from "../src/operations/allocation.service";

const adminUrl = process.env.RLS_ADMIN_DATABASE_URL;
const suite = adminUrl && process.env.DATABASE_URL ? describe : describe.skip;
const suffix = process.env.TEST_RUN_ID ?? "allocation-worker";
const guardId = `allocation-admin-${suffix}`;
const userId = `allocation-user-${suffix}`;
const companyIds = [
	`allocation-company-a-${suffix}`,
	`allocation-company-b-${suffix}`,
];
const requestIds = [
	`allocation-request-a-${suffix}`,
	`allocation-request-b-${suffix}`,
];
const policyId = `allocation-policy-${suffix}`;
const { Client } = pg;
let admin: pg.Client;

suite("PostgreSQL allocation worker", () => {
	beforeAll(async () => {
		admin = new Client({ connectionString: adminUrl });
		await admin.connect();
		await admin.query(
			"INSERT INTO \"organization\" (id,name,slug,\"createdAt\") VALUES ('workspace','IBL','ibl',NOW()) ON CONFLICT (id) DO NOTHING",
		);
		for (const [id, role, preferences] of [
			[guardId, "admin", {}],
			[userId, "team", { allocation: { capacity: 1 } }],
		] as const) {
			await admin.query(
				'INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$1,$2,true,NOW(),NOW()) ON CONFLICT (id) DO NOTHING',
				[id, `${id}@example.test`],
			);
			await admin.query(
				'INSERT INTO "userProfile" ("userId",status,"workingPreferences","createdAt","updatedAt") VALUES ($1,\'ACTIVE\',$2::jsonb,NOW(),NOW()) ON CONFLICT ("userId") DO UPDATE SET status=\'ACTIVE\',"workingPreferences"=EXCLUDED."workingPreferences"',
				[id, JSON.stringify(preferences)],
			);
			await admin.query(
				'INSERT INTO "member" (id,"organizationId","userId",role,"createdAt") VALUES ($1,\'workspace\',$2,$3,NOW()) ON CONFLICT ("organizationId","userId") DO UPDATE SET role=EXCLUDED.role',
				[`member-${id}`, id, role],
			);
		}
		for (const companyId of companyIds)
			await admin.query(
				'INSERT INTO "company" (id,name,"ownerId","createdAt","updatedAt") VALUES ($1,$1,$2,NOW(),NOW())',
				[companyId, userId],
			);
		await admin.query(
			'INSERT INTO "allocationPolicy" (id,version,name,active,rules,"createdByUserId","createdAt","activatedAt") VALUES ($1,992001,\'Capacity one\',true,\'{"defaultCapacity":1}\'::jsonb,$2,NOW(),NOW())',
			[policyId, guardId],
		);
		for (let index = 0; index < requestIds.length; index += 1)
			await admin.query(
				'INSERT INTO "allocationRequest" (id,"entityType","entityId",status,"idempotencyKey","maxAttempts","createdAt","updatedAt") VALUES ($1,\'COMPANY\',$2,\'PENDING\',$3,5,NOW(),NOW())',
				[
					requestIds[index],
					companyIds[index],
					`allocation-test:${suffix}:${index}`,
				],
			);
	});

	afterAll(async () => {
		await admin.query(
			'DELETE FROM "assignment" WHERE "entityId" = ANY($1::text[])',
			[companyIds],
		);
		await admin.query(
			'DELETE FROM "allocationRequest" WHERE id = ANY($1::text[])',
			[requestIds],
		);
		await admin.query('DELETE FROM "allocationPolicy" WHERE id=$1', [policyId]);
		await admin.query('DELETE FROM "company" WHERE id = ANY($1::text[])', [
			companyIds,
		]);
		await admin.query('DELETE FROM "member" WHERE "userId"=$1', [userId]);
		await admin.query('DELETE FROM "user" WHERE id=$1', [userId]);
		await admin.end();
		await db.$disconnect();
	});

	test("concurrent workers do not exceed capacity and explain unallocated work", async () => {
		const first = new AllocationService(db);
		const second = new AllocationService(db);
		await Promise.all([
			first.runDue("allocation-worker-a"),
			second.runDue("allocation-worker-b"),
		]);
		const rows = await admin.query(
			'SELECT status,explanation FROM "allocationRequest" WHERE id = ANY($1::text[]) ORDER BY id',
			[requestIds],
		);
		expect(rows.rows.map((row) => row.status).sort()).toEqual([
			"ALLOCATED",
			"UNALLOCATED",
		]);
		const unallocated = rows.rows.find((row) => row.status === "UNALLOCATED");
		expect(unallocated?.explanation?.eligible).toBe(false);
		expect(
			(
				await admin.query(
					'SELECT count(*)::int AS count FROM "assignment" WHERE "entityId" = ANY($1::text[]) AND "revokedAt" IS NULL',
					[companyIds],
				)
			).rows[0].count,
		).toBe(1);
	});
});
