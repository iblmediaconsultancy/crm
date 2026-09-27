import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pg from "pg";

const adminUrl = process.env.RLS_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.RLS_DATABASE_URL;
const suite = adminUrl && runtimeUrl ? describe : describe.skip;
const suffix = process.env.TEST_RUN_ID ?? "canonical-rls";
const adminUserId = `rls-admin-${suffix}`;
const teamUserId = `rls-team-${suffix}`;
const contributorUserId = `rls-contributor-${suffix}`;
const ownerCompanyId = `rls-owner-company-${suffix}`;
const sharedCompanyId = `rls-shared-company-${suffix}`;

const { Client } = pg;
let admin: pg.Client;
let runtime: pg.Client;

async function principal<T>(userId: string, run: () => Promise<T>): Promise<T> {
	await runtime.query("BEGIN");
	try {
		await runtime.query("SELECT set_config('ibl.user_id', $1, true)", [userId]);
		await runtime.query(
			"SELECT set_config('ibl.principal_kind', 'user', true)",
		);
		const result = await run();
		await runtime.query("COMMIT");
		return result;
	} catch (error) {
		await runtime.query("ROLLBACK");
		throw error;
	}
}

suite("canonical RLS lifecycle", () => {
	beforeAll(async () => {
		admin = new Client({ connectionString: adminUrl });
		runtime = new Client({ connectionString: runtimeUrl });
		await admin.connect();
		await runtime.connect();
		await admin.query(
			"INSERT INTO \"organization\" (id,name,slug,\"createdAt\") VALUES ('workspace','IBL','ibl',NOW()) ON CONFLICT (id) DO NOTHING",
		);
		for (const [id, role] of [
			[adminUserId, "admin"],
			[teamUserId, "team"],
			[contributorUserId, "contributor"],
		] as const) {
			await admin.query(
				'INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$1,$2,true,NOW(),NOW()) ON CONFLICT (id) DO NOTHING',
				[id, `${id}@example.test`],
			);
			await admin.query(
				'INSERT INTO "userProfile" ("userId",status,"workingPreferences","createdAt","updatedAt") VALUES ($1,\'ACTIVE\',\'{}\'::jsonb,NOW(),NOW()) ON CONFLICT ("userId") DO UPDATE SET status=\'ACTIVE\'',
				[id],
			);
			await admin.query(
				'INSERT INTO "member" (id,"organizationId","userId",role,"createdAt") VALUES ($1,\'workspace\',$2,$3,NOW()) ON CONFLICT ("organizationId","userId") DO UPDATE SET role=EXCLUDED.role',
				[`member-${id}`, id, role],
			);
		}
		await admin.query(
			'INSERT INTO "company" (id,name,"ownerId","createdAt","updatedAt") VALUES ($1,\'Owned\',$2,NOW(),NOW()),($3,\'Shared\',$4,NOW(),NOW()) ON CONFLICT (id) DO NOTHING',
			[ownerCompanyId, contributorUserId, sharedCompanyId, teamUserId],
		);
	});

	afterAll(async () => {
		await admin.query('DELETE FROM "company" WHERE id = ANY($1::text[])', [
			[ownerCompanyId, sharedCompanyId],
		]);
		await admin.query('DELETE FROM "member" WHERE "userId" = ANY($1::text[])', [
			[teamUserId, contributorUserId],
		]);
		await admin.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [
			[teamUserId, contributorUserId],
		]);
		await Promise.all([runtime.end(), admin.end()]);
	});

	test("Contributor updates only owned records while Team updates shared CRM", async () => {
		const owned = await principal(contributorUserId, () =>
			runtime.query(
				"UPDATE \"company\" SET description='owned update' WHERE id=$1",
				[ownerCompanyId],
			),
		);
		expect(owned.rowCount).toBe(1);
		const shared = await principal(contributorUserId, () =>
			runtime.query(
				"UPDATE \"company\" SET description='forbidden' WHERE id=$1",
				[sharedCompanyId],
			),
		);
		expect(shared.rowCount).toBe(0);
		const team = await principal(teamUserId, () =>
			runtime.query(
				"UPDATE \"company\" SET description='team update' WHERE id=$1",
				[ownerCompanyId],
			),
		);
		expect(team.rowCount).toBe(1);
	});

	test("ordinary Admin SQL cannot delete without a live consumed confirmation", async () => {
		const direct = await principal(adminUserId, () =>
			runtime.query('DELETE FROM "company" WHERE id=$1', [sharedCompanyId]),
		);
		expect(direct.rowCount).toBe(0);
		await principal(adminUserId, async () => {
			const version = (
				await runtime.query('SELECT version FROM "company" WHERE id=$1', [
					sharedCompanyId,
				])
			).rows[0].version;
			await runtime.query(
				'INSERT INTO "destructiveConfirmation" (id,"entityType","entityId","entityVersion","dependencyDigest","requestedByUserId","expiresAt","consumedAt") VALUES ($1,\'COMPANY\',$2,$3,\'test-digest\',$4,NOW()+INTERVAL \'5 minutes\',NOW())',
				[`confirmation-${suffix}`, sharedCompanyId, version, adminUserId],
			);
			const confirmed = await runtime.query(
				'DELETE FROM "company" WHERE id=$1',
				[sharedCompanyId],
			);
			expect(confirmed.rowCount).toBe(1);
		});
	});
});
