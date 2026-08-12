import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@crm/db";
import pg from "pg";
import { PostgresJobWorkerService } from "../src/providers/postgres-job-worker.service";
import type { ResendCredentialSource } from "../src/providers/provider-credentials";
import type { ResendTransport } from "../src/providers/resend-transport";

const suffix = process.env.TEST_RUN_ID ?? "postgres-queue";
const actorUserId = `queue-user-${suffix}`;
const keyPrefix = `queue-recovery:${suffix}:`;
const previousSender = process.env.RESEND_SYSTEM_FROM_EMAIL;
const adminConnectionString =
	process.env.RLS_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
if (!adminConnectionString)
	throw new Error("RLS_ADMIN_DATABASE_URL or DATABASE_URL is required");
const { Client } = pg;
let admin: pg.Client;

const credentials: ResendCredentialSource = {
	load: async () => ({ apiKey: "test-only" }),
};
const sent = new Map<string, number>();
const transport: ResendTransport = {
	send: async (_apiKey, message) => {
		sent.set(
			message.idempotencyKey,
			(sent.get(message.idempotencyKey) ?? 0) + 1,
		);
		return { providerMessageId: `provider-${message.idempotencyKey}` };
	},
};

async function clean() {
	await admin.query('DELETE FROM "securityAuditEvent" WHERE "actorUserId"=$1', [
		actorUserId,
	]);
	await admin.query(
		'DELETE FROM "systemEmailJob" WHERE "idempotencyKey" LIKE $1',
		[`${keyPrefix}%`],
	);
	await admin.query('DELETE FROM "user" WHERE id=$1', [actorUserId]);
}

beforeAll(async () => {
	process.env.RESEND_SYSTEM_FROM_EMAIL = "system@example.test";
	admin = new Client({ connectionString: adminConnectionString });
	await admin.connect();
	await clean();
	await admin.query(
		'INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,\'Queue Test\',$2,true,NOW(),NOW())',
		[actorUserId, `${actorUserId}@example.test`],
	);
	await admin.query(
		'INSERT INTO "providerCapability" (key,status,"verifiedAt","updatedAt") VALUES (\'RESEND_OUTBOUND\',\'VERIFIED\',NOW(),NOW()) ON CONFLICT (key) DO UPDATE SET status=\'VERIFIED\',"verifiedAt"=NOW()',
		[],
	);
});

afterAll(async () => {
	if (previousSender === undefined) delete process.env.RESEND_SYSTEM_FROM_EMAIL;
	else process.env.RESEND_SYSTEM_FROM_EMAIL = previousSender;
	await clean();
	await Promise.all([admin.end(), db.$disconnect()]);
});

async function insertJob(input: {
	idempotencyKey: string;
	kind: "INVITATION" | "PASSWORD_RESET";
	recipient: string;
	leased?: boolean;
}) {
	await admin.query(
		'INSERT INTO "systemEmailJob" (id,kind,"actorUserId","recipientEmail",subject,"textBody","idempotencyKey",status,"leaseOwner","leasedUntil","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,\'Synthetic test message\',$6,$7::"DurableJobStatus",$8,$9,NOW(),NOW())',
		[
			crypto.randomUUID(),
			input.kind,
			actorUserId,
			input.recipient,
			input.kind === "INVITATION" ? "Invitation" : "Reset",
			input.idempotencyKey,
			input.leased ? "LEASED" : "PENDING",
			input.leased ? "crashed-worker" : null,
			input.leased ? new Date(Date.now() - 60_000) : null,
		],
	);
}

async function statusOf(idempotencyKey: string) {
	const result = await admin.query(
		'SELECT status,"leaseOwner" FROM "systemEmailJob" WHERE "idempotencyKey"=$1',
		[idempotencyKey],
	);
	return result.rows[0] as { status: string; leaseOwner: string | null };
}

describe("PostgreSQL durable system-email queue", () => {
	test("reclaims an expired lease after a worker crash", async () => {
		const idempotencyKey = `${keyPrefix}expired`;
		await insertJob({
			idempotencyKey,
			kind: "INVITATION",
			recipient: "recipient@example.test",
			leased: true,
		});
		const worker = new PostgresJobWorkerService(db, credentials, transport);
		expect(await worker.runDue("replacement-worker")).toBe(1);
		const row = await statusOf(idempotencyKey);
		expect(row.status).toBe("SUCCEEDED");
		expect(row.leaseOwner).toBeNull();
		expect(sent.get(idempotencyKey)).toBe(1);
	});

	test("concurrent workers claim each job once", async () => {
		for (const name of ["one", "two"])
			await insertJob({
				idempotencyKey: `${keyPrefix}${name}`,
				kind: "PASSWORD_RESET",
				recipient: `${name}@example.test`,
			});
		const first = new PostgresJobWorkerService(db, credentials, transport);
		const second = new PostgresJobWorkerService(db, credentials, transport);
		await Promise.all([first.runDue("worker-a"), second.runDue("worker-b")]);
		for (const name of ["one", "two"]) {
			const idempotencyKey = `${keyPrefix}${name}`;
			expect((await statusOf(idempotencyKey)).status).toBe("SUCCEEDED");
			expect(sent.get(idempotencyKey)).toBe(1);
		}
	});
});
