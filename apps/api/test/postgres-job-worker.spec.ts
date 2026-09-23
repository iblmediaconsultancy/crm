import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@crm/db";
import pg from "pg";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { CompanyDirectoryService } from "../src/companies/company-directory.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { EnrichmentLogService } from "../src/crm/enrichment-log.service";
import { MailboxMatchService } from "../src/mailbox/mailbox-match.service";
import { ThreadWriterService } from "../src/mailbox/thread-writer.service";
import { PostgresJobWorkerService } from "../src/providers/postgres-job-worker.service";
import type { ResendCredentialSource } from "../src/providers/provider-credentials";
import type {
	ResendMessage,
	ResendTransport,
} from "../src/providers/resend-transport";

const suffix = process.env.TEST_RUN_ID ?? "postgres-queue";
const actorUserId = `queue-user-${suffix}`;
const approverUserId = `queue-approver-${suffix}`;
const keyPrefix = `queue-recovery:${suffix}:`;
const senderMailboxId = `queue-sender-mailbox-${suffix}`;
const senderContactId = `queue-sender-contact-${suffix}`;
const senderRouteId = `queue-sender-route-${suffix}`;
const senderDraftId = `queue-sender-draft-${suffix}`;
const senderDeliveryId = `queue-sender-delivery-${suffix}`;
const threadMailboxId = `queue-thread-mailbox-${suffix}`;
const threadContactId = `queue-thread-contact-${suffix}`;
const threadRouteId = `queue-thread-route-${suffix}`;
const threadLeadId = `queue-thread-lead-${suffix}`;
const threadDraftId = `queue-thread-draft-${suffix}`;
const threadDeliveryId = `queue-thread-delivery-${suffix}`;
const threadPlanId = `queue-thread-plan-${suffix}`;
const threadStepId = `queue-thread-step-${suffix}`;
const threadRecipient = `thread-recipient-${suffix}@example.test`;
const coldContactId = `queue-cold-contact-${suffix}`;
const coldRouteId = `queue-cold-route-${suffix}`;
const coldDraftId = `queue-cold-draft-${suffix}`;
const coldDeliveryId = `queue-cold-delivery-${suffix}`;
const coldMailboxId = `queue-cold-mailbox-${suffix}`;
const coldQuotaDay = new Date("2099-01-01T00:00:00.000Z");
const previousSender = process.env.RESEND_SYSTEM_FROM_EMAIL;
const previousOutreachSender = process.env.RESEND_OUTREACH_FROM_EMAIL;
const adminConnectionString =
	process.env.RLS_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
if (!adminConnectionString)
	throw new Error("RLS_ADMIN_DATABASE_URL or DATABASE_URL is required");
const { Client } = pg;
let admin: pg.Client;
let coldMailboxCreated = false;

const credentials: ResendCredentialSource = {
	load: async () => ({ apiKey: "test-only" }),
};
const sent = new Map<string, number>();
const sentMessages = new Map<string, ResendMessage>();
const transport: ResendTransport = {
	send: async (_apiKey, message) => {
		sent.set(
			message.idempotencyKey,
			(sent.get(message.idempotencyKey) ?? 0) + 1,
		);
		sentMessages.set(message.idempotencyKey, message);
		return { providerMessageId: `provider-${message.idempotencyKey}` };
	},
};

const agent = {
	contactCreated: async () => undefined,
	companyCreated: async () => undefined,
	companyRequested: async () => undefined,
} as unknown as AgentTriggerService;

async function clean() {
	await admin.query('DELETE FROM "securityAuditEvent" WHERE "actorUserId"=$1', [
		actorUserId,
	]);
	await admin.query(
		'DELETE FROM "systemEmailJob" WHERE "idempotencyKey" LIKE $1',
		[`${keyPrefix}%`],
	);
	await admin.query('DELETE FROM "outboundDelivery" WHERE id=$1', [
		senderDeliveryId,
	]);
	await admin.query('DELETE FROM "followUpStep" WHERE id=$1', [threadStepId]);
	await admin.query('DELETE FROM "followUpPlan" WHERE id=$1', [threadPlanId]);
	await admin.query(
		'DELETE FROM "activity" WHERE "emailThreadId" IN (SELECT id FROM "emailThread" WHERE "mailboxId"=$1)',
		[threadMailboxId],
	);
	await admin.query('DELETE FROM "emailThread" WHERE "mailboxId"=$1', [
		threadMailboxId,
	]);
	await admin.query('DELETE FROM "outboundDelivery" WHERE id=$1', [
		threadDeliveryId,
	]);
	await admin.query('DELETE FROM "draft" WHERE id=$1', [threadDraftId]);
	await admin.query('DELETE FROM "leadStageHistory" WHERE "leadId"=$1', [
		threadLeadId,
	]);
	await admin.query('DELETE FROM "lead" WHERE id=$1', [threadLeadId]);
	await admin.query('DELETE FROM "contactRoute" WHERE id=$1', [threadRouteId]);
	await admin.query('DELETE FROM "contact" WHERE id=$1', [threadContactId]);
	await admin.query('DELETE FROM "mailbox" WHERE id=$1', [threadMailboxId]);
	await admin.query('DELETE FROM "outboundDelivery" WHERE id=$1', [
		coldDeliveryId,
	]);
	await admin.query('DELETE FROM "outreachQuota" WHERE day=$1', [coldQuotaDay]);
	await admin.query('DELETE FROM "draft" WHERE id=$1', [coldDraftId]);
	await admin.query('DELETE FROM "contactRoute" WHERE id=$1', [coldRouteId]);
	await admin.query('DELETE FROM "contact" WHERE id=$1', [coldContactId]);
	if (coldMailboxCreated)
		await admin.query('DELETE FROM "mailbox" WHERE id=$1', [coldMailboxId]);
	await admin.query('DELETE FROM "draft" WHERE id=$1', [senderDraftId]);
	await admin.query('DELETE FROM "contactRoute" WHERE id=$1', [senderRouteId]);
	await admin.query('DELETE FROM "contact" WHERE id=$1', [senderContactId]);
	await admin.query('DELETE FROM "mailbox" WHERE id=$1', [senderMailboxId]);
	await admin.query('DELETE FROM "user" WHERE id=$1', [approverUserId]);
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
		'INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,\'Queue Approver\',$2,true,NOW(),NOW())',
		[approverUserId, `${approverUserId}@example.test`],
	);
	await admin.query(
		'INSERT INTO "providerCapability" (key,status,"verifiedAt","updatedAt") VALUES (\'RESEND_OUTBOUND\',\'VERIFIED\',NOW(),NOW()) ON CONFLICT (key) DO UPDATE SET status=\'VERIFIED\',"verifiedAt"=NOW()',
		[],
	);
	const existingColdMailbox = await db.mailbox.findFirst({
		where: { normalizedAddress: "outreach@iblmedia.com" },
		select: { id: true },
	});
	if (!existingColdMailbox) {
		await db.mailbox.create({
			data: {
				id: coldMailboxId,
				ownerUserId: actorUserId,
				address: "outreach@iblmedia.com",
				normalizedAddress: "outreach@iblmedia.com",
				status: "VERIFIED",
			},
		});
		coldMailboxCreated = true;
	}
});

afterAll(async () => {
	if (previousSender === undefined) delete process.env.RESEND_SYSTEM_FROM_EMAIL;
	else process.env.RESEND_SYSTEM_FROM_EMAIL = previousSender;
	if (previousOutreachSender === undefined)
		delete process.env.RESEND_OUTREACH_FROM_EMAIL;
	else process.env.RESEND_OUTREACH_FROM_EMAIL = previousOutreachSender;
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

	test("rejects an unapproved Atlas sender before calling Resend", async () => {
		await db.mailbox.create({
			data: {
				id: senderMailboxId,
				ownerUserId: actorUserId,
				address: `outreach-${suffix}@example.test`,
				normalizedAddress: `outreach-${suffix}@example.test`,
				status: "VERIFIED",
			},
		});
		await db.contact.create({
			data: {
				id: senderContactId,
				firstName: "Recipient",
				email: `recipient-${suffix}@example.test`,
			},
		});
		await db.contactRoute.create({
			data: {
				id: senderRouteId,
				contactId: senderContactId,
				ownerUserId: actorUserId,
				type: "EMAIL",
				value: `recipient-${suffix}@example.test`,
				normalizedValue: `recipient-${suffix}@example.test`,
			},
		});
		await db.draft.create({
			data: {
				id: senderDraftId,
				ownerUserId: actorUserId,
				mailboxId: senderMailboxId,
				recipientRouteId: senderRouteId,
				subject: "Sender policy test",
				body: "Test only",
				status: "DRAFT",
				approvedAt: new Date(),
				idempotencyKey: `${keyPrefix}sender-draft`,
			},
		});
		await db.outreachApproval.create({
			data: {
				draftId: senderDraftId,
				requestedById: actorUserId,
				decidedById: approverUserId,
				status: "APPROVED",
				decidedAt: new Date(),
				idempotencyKey: `${keyPrefix}sender-approval`,
			},
		});
		await db.draft.update({
			where: { id: senderDraftId },
			data: { status: "QUEUED" },
		});
		await db.outboundDelivery.create({
			data: {
				id: senderDeliveryId,
				draftId: senderDraftId,
				idempotencyKey: `${keyPrefix}sender-delivery`,
			},
		});

		const previous = process.env.RESEND_OUTREACH_FROM_EMAIL;
		process.env.RESEND_OUTREACH_FROM_EMAIL = "info@iblmedia.com";
		try {
			const worker = new PostgresJobWorkerService(db, credentials, transport);
			expect(await worker.runDue("sender-policy-worker")).toBe(1);
			expect(sent.has(`${keyPrefix}sender-delivery`)).toBe(false);
			expect(
				await db.outboundDelivery.findUnique({
					where: { id: senderDeliveryId },
					select: {
						status: true,
						retryAt: true,
						attemptCount: true,
						lastErrorCode: true,
					},
				}),
			).toEqual({
				status: "FAILED",
				retryAt: null,
				attemptCount: 1,
				lastErrorCode: "RESEND_OUTREACH_SENDER_MISMATCH",
			});
			expect(await worker.runDue("sender-policy-worker-repeat")).toBe(0);
			expect(sent.has(`${keyPrefix}sender-delivery`)).toBe(false);

			const retryCalls = { count: 0 };
			const retryTransport: ResendTransport = {
				send: async () => {
					retryCalls.count += 1;
					throw new Error("TIMEOUT");
				},
			};
			process.env.RESEND_OUTREACH_FROM_EMAIL = "outreach@iblmedia.com";
			await db.draft.update({
				where: { id: senderDraftId },
				data: { status: "QUEUED", failureCode: null },
			});
			await db.outboundDelivery.update({
				where: { id: senderDeliveryId },
				data: { status: "PENDING", attemptCount: 0, retryAt: null },
			});
			const retryWorker = new PostgresJobWorkerService(
				db,
				credentials,
				retryTransport,
			);
			expect(await retryWorker.runDue("sender-retry-worker")).toBe(1);
			let retryState = await db.outboundDelivery.findUniqueOrThrow({
				where: { id: senderDeliveryId },
				select: { status: true, retryAt: true, attemptCount: true },
			});
			expect(retryState.status).toBe("RETRY");
			expect(retryState.attemptCount).toBe(1);
			expect(retryState.retryAt?.getTime()).toBeGreaterThan(Date.now());
			expect(await retryWorker.runDue("sender-retry-worker-same-pass")).toBe(0);
			for (let attempt = 2; attempt <= 5; attempt += 1) {
				await db.outboundDelivery.update({
					where: { id: senderDeliveryId },
					data: { retryAt: new Date(Date.now() - 1_000) },
				});
				expect(await retryWorker.runDue(`sender-retry-worker-${attempt}`)).toBe(
					1,
				);
			}
			retryState = await db.outboundDelivery.findUniqueOrThrow({
				where: { id: senderDeliveryId },
				select: { status: true, retryAt: true, attemptCount: true },
			});
			expect(retryState).toEqual({
				status: "FAILED",
				retryAt: null,
				attemptCount: 5,
			});
			expect(retryCalls.count).toBe(5);
			expect(await retryWorker.runDue("sender-retry-worker-after-dead")).toBe(
				0,
			);
		} finally {
			if (previous === undefined) delete process.env.RESEND_OUTREACH_FROM_EMAIL;
			else process.env.RESEND_OUTREACH_FROM_EMAIL = previous;
		}
	});

	test("persists outbound CRM mail and merges the inbound reply into one lead thread", async () => {
		await db.mailbox.create({
			data: {
				id: threadMailboxId,
				ownerUserId: actorUserId,
				address: `thread-mailbox-${suffix}@example.test`,
				normalizedAddress: `thread-mailbox-${suffix}@example.test`,
				status: "VERIFIED",
			},
		});
		await db.contact.create({
			data: {
				id: threadContactId,
				firstName: "Ihsan",
				lastName: "Bal",
				email: threadRecipient,
			},
		});
		await db.contactRoute.create({
			data: {
				id: threadRouteId,
				contactId: threadContactId,
				ownerUserId: actorUserId,
				type: "EMAIL",
				value: threadRecipient,
				normalizedValue: threadRecipient,
			},
		});
		await db.lead.create({
			data: {
				id: threadLeadId,
				name: "Ihsan Bal",
				stage: "READY",
				contactId: threadContactId,
				ownerUserId: actorUserId,
				createdByUserId: actorUserId,
			},
		});
		await db.followUpPlan.create({
			data: {
				id: threadPlanId,
				contactId: threadContactId,
				routeId: threadRouteId,
				ownerUserId: actorUserId,
				leadId: threadLeadId,
			},
		});
		await db.followUpStep.create({
			data: {
				id: threadStepId,
				planId: threadPlanId,
				position: 1,
				dueAt: new Date("2030-01-02T10:00:00Z"),
				idempotencyKey: `${keyPrefix}thread-step`,
			},
		});
		await db.draft.create({
			data: {
				id: threadDraftId,
				ownerUserId: actorUserId,
				mailboxId: threadMailboxId,
				recipientRouteId: threadRouteId,
				leadId: threadLeadId,
				subject: "Controlled thread test",
				body: "Thanks for connecting.",
				status: "DRAFT",
				idempotencyKey: `${keyPrefix}thread-draft`,
			},
		});
		await db.outreachApproval.create({
			data: {
				draftId: threadDraftId,
				requestedById: actorUserId,
				decidedById: approverUserId,
				status: "APPROVED",
				decidedAt: new Date(),
				idempotencyKey: `${keyPrefix}thread-approval`,
			},
		});
		await db.draft.update({
			where: { id: threadDraftId },
			data: { status: "QUEUED", approvedAt: new Date() },
		});
		await db.outboundDelivery.create({
			data: {
				id: threadDeliveryId,
				draftId: threadDraftId,
				idempotencyKey: `${keyPrefix}thread-delivery`,
			},
		});

		const worker = new PostgresJobWorkerService(db, credentials, transport);
		expect(await worker.runDue("thread-worker")).toBe(1);
		const outbound = sentMessages.get(`ibl-outbound:${threadDraftId}`);
		expect(outbound?.messageId).toBe(`<ibl-${threadDraftId}@iblmedia.com>`);
		expect(
			await db.outboundDelivery.findUnique({
				where: { id: threadDeliveryId },
				select: { providerMessageId: true },
			}),
		).toEqual({ providerMessageId: `provider-ibl-outbound:${threadDraftId}` });
		expect(
			await db.emailMessage.findMany({
				where: { mailboxId: threadMailboxId },
				select: { direction: true, rfcMessageId: true },
			}),
		).toEqual([
			{
				direction: "OUTBOUND",
				rfcMessageId: `<ibl-${threadDraftId}@iblmedia.com>`,
			},
		]);

		const stamp = new ActivityStampService(db);
		const directory = new CompanyDirectoryService(db, agent);
		const log = new EnrichmentLogService(db, stamp);
		const match = new MailboxMatchService(db, directory, agent, log, {
			detectContact: async () => [],
		} as never);
		const threads = new ThreadWriterService(db, match, stamp);
		await threads.store(
			{
				id: `sync-${threadMailboxId}`,
				userId: actorUserId,
				source: "miab",
				mailboxId: threadMailboxId,
				status: "IDLE",
				cursor: null,
				lastSyncedAt: null,
				lastError: null,
				retryAfter: null,
				attemptCount: 0,
				leaseOwner: null,
				lastErrorCode: null,
				autoCreate: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			} as never,
			{ mailbox: "outreach@iblmedia.com", origin: "miab" },
			{
				rfcMessageId: `<reply-${threadDraftId}@icloud.com>`,
				rootId: `provider-ibl-outbound:${threadDraftId}`,
				subject: "Re: Controlled thread test",
				from: { email: threadRecipient, name: "Ihsan Bal" },
				recipients: [
					{
						email: "outreach@iblmedia.com",
						name: "IBL Media Team",
						kind: "to",
					},
				],
				body: "Interested in hearing more.",
				sentAt: new Date("2026-01-05T11:00:00Z"),
			},
			await threads.context(),
		);

		expect(
			await db.emailThread.findMany({
				where: { mailboxId: threadMailboxId },
				select: { messageCount: true, contactId: true, leadId: true },
			}),
		).toEqual([
			{ messageCount: 2, contactId: threadContactId, leadId: threadLeadId },
		]);
		expect(
			await db.lead.findMany({
				where: { contactId: threadContactId },
				select: { stage: true, attentionState: true, handoffReason: true },
			}),
		).toEqual([
			{ stage: "REPLIED", attentionState: "NONE", handoffReason: null },
		]);
		expect(
			await db.followUpPlan.findUnique({
				where: { id: threadPlanId },
				select: { status: true, cancellationReason: true },
			}),
		).toEqual({
			status: "CANCELLED",
			cancellationReason: "Inbound reply received",
		});
	});

	test("cancels a queued cold draft without active Atlas authorization", async () => {
		const coldMailbox = await db.mailbox.findFirst({
			where: { normalizedAddress: "outreach@iblmedia.com" },
			select: { id: true },
		});
		if (!coldMailbox)
			throw new Error("The verified Atlas mailbox is required.");
		await db.contact.create({
			data: {
				id: coldContactId,
				firstName: "Cold",
				lastName: "Policy",
				email: `cold-policy-${suffix}@example.test`,
			},
		});
		await db.contactRoute.create({
			data: {
				id: coldRouteId,
				contactId: coldContactId,
				ownerUserId: actorUserId,
				type: "EMAIL",
				value: `cold-policy-${suffix}@example.test`,
				normalizedValue: `cold-policy-${suffix}@example.test`,
			},
		});
		await db.draft.create({
			data: {
				id: coldDraftId,
				ownerUserId: actorUserId,
				mailboxId: coldMailbox.id,
				recipientRouteId: coldRouteId,
				subject: "Cold authorization test",
				body: "Test only",
				coldOutreach: true,
				status: "DRAFT",
				approvedAt: new Date(),
				idempotencyKey: `${keyPrefix}cold-draft`,
				createdAt: coldQuotaDay,
			},
		});
		await admin.query(
			'INSERT INTO "outreachQuota" (id,day,"coldEmailLimit","coldEmailReserved","coldEmailSent","createdAt","updatedAt") VALUES ($1,$2,90,1,0,NOW(),NOW())',
			[`quota-${suffix}`, coldQuotaDay],
		);
		await db.outreachApproval.create({
			data: {
				draftId: coldDraftId,
				requestedById: actorUserId,
				decidedById: approverUserId,
				status: "APPROVED",
				decidedAt: new Date(),
				idempotencyKey: `${keyPrefix}cold-approval`,
			},
		});
		await db.draft.update({
			where: { id: coldDraftId },
			data: { status: "QUEUED" },
		});
		await db.outboundDelivery.create({
			data: {
				id: coldDeliveryId,
				draftId: coldDraftId,
				idempotencyKey: `${keyPrefix}cold-delivery`,
			},
		});

		const previous = process.env.ATLAS_LIVE_OUTREACH_ENABLED;
		process.env.ATLAS_LIVE_OUTREACH_ENABLED = "false";
		try {
			const worker = new PostgresJobWorkerService(db, credentials, transport);
			expect(await worker.runDue("cold-policy-worker")).toBe(1);
			expect(sent.has(`${keyPrefix}cold-delivery`)).toBe(false);
			expect(
				await db.outboundDelivery.findUnique({
					where: { id: coldDeliveryId },
					select: { status: true, lastErrorCode: true },
				}),
			).toEqual({
				status: "CANCELLED",
				lastErrorCode: "OUTBOUND_ATLAS_AUTHORIZATION_REQUIRED",
			});
			expect(
				await db.outreachQuota.findUnique({
					where: { day: coldQuotaDay },
					select: { coldEmailReserved: true },
				}),
			).toEqual({ coldEmailReserved: 0 });
		} finally {
			if (previous === undefined)
				delete process.env.ATLAS_LIVE_OUTREACH_ENABLED;
			else process.env.ATLAS_LIVE_OUTREACH_ENABLED = previous;
		}
	});
});
