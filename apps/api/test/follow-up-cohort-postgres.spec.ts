import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { FOLLOW_UP_COHORT_CLAIM_SQL } from "../src/providers/follow-up-claim";
import { CLAIM_OUTBOUND } from "../src/providers/postgres-job-worker.service";

const connectionString =
	process.env.RLS_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString)
	throw new Error("RLS_ADMIN_DATABASE_URL or DATABASE_URL is required");

const { Client } = pg;
const admin = new Client({ connectionString });

beforeAll(async () => {
	await admin.connect();
});

afterAll(async () => {
	await admin.end();
});

describe("PostgreSQL exact-ID follow-up cohort claims", () => {
	test("claims only persisted cohort members and isolates cohort authorization from cold sends", async () => {
		const actorId = crypto.randomUUID();
		const draftId = crypto.randomUUID();
		const cohortId = crypto.randomUUID();
		const authorizationId = crypto.randomUUID();
		const deliveryId = crypto.randomUUID();
		const runId = crypto.randomUUID();
		const stepIds: string[] = Array.from({ length: 10 }, () =>
			crypto.randomUUID(),
		);
		const contactIds: string[] = Array.from({ length: 10 }, () =>
			crypto.randomUUID(),
		);
		const routeIds: string[] = Array.from({ length: 10 }, () =>
			crypto.randomUUID(),
		);
		const selectedIds = stepIds
			.filter((_stepId, index) => [1, 4, 9].includes(index))
			.sort();
		await admin.query("BEGIN");
		try {
			const existingMailbox = await admin.query(
				' SELECT id FROM "mailbox" WHERE "normalizedAddress"=\'outreach@iblmedia.com\' LIMIT 1',
			);
			const mailboxId =
				(existingMailbox.rows[0]?.id as string | undefined) ??
				crypto.randomUUID();
			const settings = await admin.query(
				'INSERT INTO "appSetting" (id,"atlasLiveOutreachEnabled","updatedAt") VALUES (\'app\',true,NOW()) ON CONFLICT (id) DO UPDATE SET "atlasLiveOutreachEnabled"=true,"updatedAt"=NOW() RETURNING id',
			);
			expect(settings.rowCount).toBe(1);
			await admin.query(
				'INSERT INTO "user" (id,name,email,"emailVerified",kind,"createdAt","updatedAt") VALUES ($1,\'Cohort Test\',$2,true,\'SYSTEM_OPERATOR\',NOW(),NOW())',
				[actorId, `${actorId}@example.test`],
			);
			if (!existingMailbox.rowCount)
				await admin.query(
					'INSERT INTO "mailbox" (id,"ownerUserId",address,"normalizedAddress",status,"verifiedAt","createdAt","updatedAt") VALUES ($1,$2,\'outreach@iblmedia.com\',\'outreach@iblmedia.com\',\'VERIFIED\',NOW(),NOW(),NOW())',
					[mailboxId, actorId],
				);
			await admin.query(
				'INSERT INTO "draft" (id,"ownerUserId","mailboxId",subject,body,"coldOutreach",status,"idempotencyKey","createdAt","updatedAt") VALUES ($1,$2,$3,\'Cohort test\',\'Isolated test\',true,\'DRAFT\',$4,NOW(),NOW())',
				[draftId, actorId, mailboxId, `cohort-test-draft:${runId}`],
			);
			for (let index = 0; index < stepIds.length; index += 1) {
				const planId = crypto.randomUUID();
				const email = `cohort-${runId}-${index}@example.test`;
				await admin.query(
					'INSERT INTO "contact" (id,"firstName",email,"createdAt","updatedAt") VALUES ($1,$2,$3,NOW(),NOW())',
					[contactIds[index], `Contact ${index}`, email],
				);
				await admin.query(
					'INSERT INTO "contactRoute" (id,"contactId","ownerUserId",type,value,"normalizedValue","createdAt","updatedAt") VALUES ($1,$2,$3,\'EMAIL\',$4,$4,NOW(),NOW())',
					[routeIds[index], contactIds[index], actorId, email],
				);
				await admin.query(
					'INSERT INTO "followUpPlan" (id,"contactId","routeId",channel,"ownerUserId",status,"createdAt","updatedAt") VALUES ($1,$2,$3,\'EMAIL\',$4,\'ACTIVE\',NOW(),NOW())',
					[planId, contactIds[index], routeIds[index], actorId],
				);
				await admin.query(
					'INSERT INTO "followUpStep" (id,"planId",position,"dueAt","draftId","idempotencyKey","createdAt","updatedAt") VALUES ($1,$2,0,(CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')-INTERVAL \'1 day\',$3,$4,NOW(),NOW())',
					[
						stepIds[index],
						planId,
						draftId,
						`cohort-test-step:${runId}:${index}`,
					],
				);
			}
			await admin.query(
				'INSERT INTO "followUpExecutionCohort" (id,state,"createdById","sourceContext","createdAt","updatedAt") VALUES ($1,\'BUILDING\',$2,$3::jsonb,NOW(),NOW())',
				[
					cohortId,
					actorId,
					JSON.stringify({
						requestedStepIds: stepIds,
						includedStepIds: selectedIds,
					}),
				],
			);
			for (const stepId of selectedIds)
				await admin.query(
					'INSERT INTO "followUpExecutionCohortMember" (id,"cohortId","followUpStepId","canonicalDueAt","createdAt","updatedAt") VALUES ($1,$2,$3,(CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')-INTERVAL \'1 day\',NOW(),NOW())',
					[crypto.randomUUID(), cohortId, stepId],
				);
			await admin.query(
				'UPDATE "followUpExecutionCohort" SET state=\'READY\',"updatedAt"=NOW() WHERE id=$1',
				[cohortId],
			);
			await admin.query(
				'INSERT INTO "outreachAuthorization" (id,"authorizedById",scope,status,"expiresAt","followUpCohortId","issuedAt","createdAt","updatedAt") VALUES ($1,$2,\'STANDARD_COLD_OUTREACH\',\'ACTIVE\',NOW()+INTERVAL \'10 minutes\',$3,NOW(),NOW(),NOW())',
				[authorizationId, actorId, cohortId],
			);
			await admin.query(
				'UPDATE "followUpExecutionCohort" SET state=\'ACTIVE\',"updatedAt"=NOW() WHERE id=$1',
				[cohortId],
			);
			await admin.query(
				'UPDATE "draft" SET "authorizationId"=$2,"atlasAuthorizedAt"=NOW(),"approvedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1',
				[draftId, authorizationId],
			);
			await admin.query("SAVEPOINT membership_immutability");
			let membershipInsertCode: string | null = null;
			try {
				await admin.query(
					'INSERT INTO "followUpExecutionCohortMember" (id,"cohortId","followUpStepId","canonicalDueAt","createdAt","updatedAt") VALUES ($1,$2,$3,(CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')-INTERVAL \'1 day\',NOW(),NOW())',
					[crypto.randomUUID(), cohortId, stepIds[0]],
				);
			} catch (error) {
				membershipInsertCode = (error as { code?: string }).code ?? null;
			}
			await admin.query("ROLLBACK TO SAVEPOINT membership_immutability");
			expect(membershipInsertCode).toBe("23514");
			expect(
				(
					await admin.query(
						' SELECT count(*)::int AS count FROM "followUpExecutionCohortMember" WHERE "cohortId"=$1',
						[cohortId],
					)
				).rows[0].count,
			).toBe(3);
			await admin.query("SAVEPOINT queued_member_blocking");
			await admin.query(
				'UPDATE "followUpExecutionCohortMember" SET status=\'QUEUED\',"updatedAt"=NOW() WHERE "cohortId"=$1 AND "followUpStepId"=$2',
				[cohortId, selectedIds[0]],
			);
			await admin.query(
				'UPDATE "followUpExecutionCohortMember" SET status=\'BLOCKED\',"blockReason"=\'PREFLIGHT_CHANGED\',"updatedAt"=NOW() WHERE "cohortId"=$1 AND "followUpStepId"=$2',
				[cohortId, selectedIds[0]],
			);
			expect(
				(
					await admin.query(
						' SELECT status,"blockReason" FROM "followUpExecutionCohortMember" WHERE "cohortId"=$1 AND "followUpStepId"=$2',
						[cohortId, selectedIds[0]],
					)
				).rows[0],
			).toEqual({ status: "BLOCKED", blockReason: "PREFLIGHT_CHANGED" });
			await admin.query("ROLLBACK TO SAVEPOINT queued_member_blocking");
			await admin.query(
				'INSERT INTO "outboundDelivery" (id,"draftId","idempotencyKey",status,"createdAt","updatedAt") VALUES ($1,$2,$3,\'PENDING\',NOW(),NOW())',
				[deliveryId, draftId, `non-cohort-cold-delivery:${runId}`],
			);

			const unrelatedColdClaim = await admin.query(CLAIM_OUTBOUND, [
				`cohort-outbound:${runId}`,
				true,
				true,
				true,
			]);
			expect(unrelatedColdClaim.rowCount).toBe(0);
			expect(
				(
					await admin.query(
						' SELECT status,"attemptCount","leaseOwner" FROM "outboundDelivery" WHERE id=$1',
						[deliveryId],
					)
				).rows[0],
			).toEqual({ status: "PENDING", attemptCount: 0, leaseOwner: null });

			const resetSelectedSteps = async () =>
				admin.query(
					'UPDATE "followUpStep" SET status=\'PENDING\',"attemptCount"=0,"leaseOwner"=NULL,"leasedUntil"=NULL WHERE id=ANY($1::text[])',
					[selectedIds],
				);
			await resetSelectedSteps();
			await admin.query(
				'UPDATE "outreachAuthorization" SET "expiresAt"=NOW()-INTERVAL \'1 minute\' WHERE id=$1',
				[authorizationId],
			);
			expect(
				(
					await admin.query(FOLLOW_UP_COHORT_CLAIM_SQL, [
						`cohort-expired:${runId}`,
						cohortId,
						true,
						true,
					])
				).rowCount,
			).toBe(0);
			await admin.query(
				"UPDATE \"outreachAuthorization\" SET status='REVOKED',\"expiresAt\"=NOW()+INTERVAL '10 minutes' WHERE id=$1",
				[authorizationId],
			);
			expect(
				(
					await admin.query(FOLLOW_UP_COHORT_CLAIM_SQL, [
						`cohort-revoked:${runId}`,
						cohortId,
						true,
						true,
					])
				).rowCount,
			).toBe(0);
			await admin.query(
				"UPDATE \"outreachAuthorization\" SET status='ACTIVE' WHERE id=$1",
				[authorizationId],
			);
			await admin.query(
				'UPDATE "appSetting" SET "atlasLiveOutreachEnabled"=false,"updatedAt"=NOW() WHERE id=\'app\'',
			);
			expect(
				(
					await admin.query(FOLLOW_UP_COHORT_CLAIM_SQL, [
						`cohort-live-off:${runId}`,
						cohortId,
						true,
						true,
					])
				).rowCount,
			).toBe(0);
			await admin.query(
				'UPDATE "appSetting" SET "atlasLiveOutreachEnabled"=true,"updatedAt"=NOW() WHERE id=\'app\'',
			);
			await admin.query(
				"UPDATE \"outreachAuthorization\" SET status='ACTIVE',\"expiresAt\"=NOW()+INTERVAL '10 minutes' WHERE id=$1",
				[authorizationId],
			);

			const claimedIds: string[] = [];
			for (let index = 0; index < selectedIds.length; index += 1) {
				const claimed = await admin.query(FOLLOW_UP_COHORT_CLAIM_SQL, [
					`cohort-worker:${runId}`,
					cohortId,
					true,
					true,
				]);
				if (claimed.rowCount) claimedIds.push(claimed.rows[0].id as string);
			}
			claimedIds.sort();
			expect(claimedIds).toEqual(selectedIds);
			const repeated = await admin.query(FOLLOW_UP_COHORT_CLAIM_SQL, [
				`cohort-worker-repeat:${runId}`,
				cohortId,
				true,
				true,
			]);
			expect(repeated.rowCount).toBe(0);

			const states = await admin.query(
				' SELECT id,status,"attemptCount","leaseOwner" FROM "followUpStep" WHERE id=ANY($1::text[]) ORDER BY id',
				[stepIds],
			);
			const mutated = states.rows
				.filter(
					(row) =>
						row.status !== "PENDING" ||
						row.attemptCount !== 0 ||
						row.leaseOwner !== null,
				)
				.map((row) => row.id as string)
				.sort();
			expect(mutated).toEqual(selectedIds);
			for (const row of states.rows) {
				if (selectedIds.includes(row.id as string)) {
					expect(row).toMatchObject({
						status: "LEASED",
						attemptCount: 1,
						leaseOwner: `cohort-worker:${runId}`,
					});
				} else {
					expect(row).toMatchObject({
						status: "PENDING",
						attemptCount: 0,
						leaseOwner: null,
					});
				}
			}
			await resetSelectedSteps();
			await admin.query(
				"UPDATE \"outreachAuthorization\" SET status='REVOKED' WHERE id=$1",
				[authorizationId],
			);
			await admin.query('DELETE FROM "outreachAuthorization" WHERE id=$1', [
				authorizationId,
			]);
			expect(
				(
					await admin.query(FOLLOW_UP_COHORT_CLAIM_SQL, [
						`cohort-no-auth:${runId}`,
						cohortId,
						true,
						true,
					])
				).rowCount,
			).toBe(0);
		} finally {
			await admin.query("ROLLBACK");
		}
	});
});
