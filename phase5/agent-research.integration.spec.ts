import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	auditDeniedCapability,
	requireIblAgentIdentity,
} from "../apps/agent/agent/lib/ibl-agent-policy";
import {
	claimResearchRequests,
	createResearchDraft,
	createResearchProposal,
	inspectResearchRequest,
	recordEvidence,
	recordFinding,
	settleResearchRequest,
	submitResearchForReview,
} from "../apps/agent/agent/lib/ibl-research";
import type { PurposeContext } from "../apps/agent/agent/lib/session-purpose";
import { PrismaPg } from "../packages/db/node_modules/@prisma/adapter-pg";
import { PrismaClient } from "../packages/db/src/index";

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
if (!migrationUrl || !process.env.DATABASE_URL) {
	throw new Error("Phase 5 database URLs are required.");
}

const migration = new PrismaClient({
	adapter: new PrismaPg({ connectionString: migrationUrl }),
});
const run = `${Date.now()}`;
const owner = `phase5-owner-${run}`;
const other = `phase5-other-${run}`;
const target = `phase5-contact-${run}`;
const mailbox = `phase5-mailbox-${run}`;
const otherMailbox = `phase5-other-mailbox-${run}`;
const profileRequest = `phase5-profile-request-${run}`;
const mailboxRequest = `phase5-mailbox-request-${run}`;
const queueRequest = `phase5-queue-request-${run}`;
const lead = `phase5-lead-${run}`;

function context(input: {
	userId?: string;
	requestId?: string;
	mailboxId?: string;
	targetEntityId?: string;
}) {
	return {
		session: {
			auth: {
				current: {
					attributes: {
						purpose: "research",
						userId: input.userId ?? owner,
						researchRequestId: input.requestId ?? profileRequest,
						targetType: "CONTACT",
						targetEntityId: input.targetEntityId ?? target,
						...(input.mailboxId ? { mailboxId: input.mailboxId } : {}),
					},
				},
				initiator: null,
			},
		},
	} as PurposeContext;
}

beforeAll(async () => {
	await migration.organization.upsert({
		where: { id: "workspace" },
		create: {
			id: "workspace",
			name: "IBL Media Consultancy",
			slug: "ibl",
			createdAt: new Date(),
		},
		update: {},
	});
	for (const userId of [owner, other]) {
		await migration.user.create({
			data: {
				id: userId,
				name: userId,
				email: `${userId}@phase5.test`,
				emailVerified: true,
			},
		});
		await migration.userProfile.create({ data: { userId, status: "ACTIVE" } });
		await migration.member.create({
			data: {
				id: `member-${userId}`,
				organizationId: "workspace",
				userId,
				role: "team",
				createdAt: new Date(),
			},
		});
	}
	await migration.contact.create({
		data: { id: target, firstName: "Phase", lastName: "Five", ownerId: owner },
	});
	await migration.lead.create({
		data: {
			id: lead,
			name: "Phase 5 synthetic lead",
			contactId: target,
			ownerUserId: owner,
			createdByUserId: owner,
		},
	});
	for (const [id, userId] of [
		[mailbox, owner],
		[otherMailbox, other],
	] as const) {
		await migration.mailbox.create({
			data: {
				id,
				ownerUserId: userId,
				address: `${id}@phase5.test`,
				normalizedAddress: `${id}@phase5.test`,
				status: "UNVERIFIED",
			},
		});
	}
	await migration.researchRequest.createMany({
		data: [
			{
				id: profileRequest,
				ownerUserId: owner,
				targetType: "CONTACT",
				targetEntityId: target,
				prompt: "Profile-only synthetic research",
				idempotencyKey: profileRequest,
				status: "RUNNING",
			},
			{
				id: mailboxRequest,
				ownerUserId: owner,
				mailboxId: mailbox,
				targetType: "CONTACT",
				targetEntityId: target,
				prompt: "Mailbox-scoped synthetic research",
				idempotencyKey: mailboxRequest,
				status: "RUNNING",
			},
			{
				id: queueRequest,
				ownerUserId: owner,
				mailboxId: mailbox,
				targetType: "CONTACT",
				targetEntityId: target,
				prompt: "Durable queue synthetic research",
				idempotencyKey: queueRequest,
				status: "QUEUED",
				createdAt: new Date("2000-01-01T00:00:00.000Z"),
			},
		],
	});
});

afterAll(async () => {
	await migration.$disconnect();
});

describe("IBL Eve identity and data boundaries", () => {
	test("derives profile-only, mailbox, and CRM-target envelopes", async () => {
		const profile = await inspectResearchRequest(context({}));
		expect(profile.identity.mailbox).toBeNull();
		expect(profile.identity.crmTarget).toEqual({ kind: "CONTACT", id: target });

		const scoped = await inspectResearchRequest(
			context({ requestId: mailboxRequest, mailboxId: mailbox }),
		);
		expect(scoped.identity.mailbox?.mailboxId).toBe(mailbox);
		expect(scoped.identity.mailbox?.verificationStatus).toBe("UNVERIFIED");
	});

	test("rejects mailbox and target tampering before domain access", async () => {
		await expect(
			inspectResearchRequest(
				context({ requestId: mailboxRequest, mailboxId: otherMailbox }),
			),
		).rejects.toThrow("does not belong");
		await expect(
			inspectResearchRequest(context({ targetEntityId: `forged-${run}` })),
		).rejects.toThrow("outside this identity envelope");
		expect(
			await migration.securityAuditEvent.count({
				where: { actorUserId: owner, action: "IDENTITY_MAILBOX_MISMATCH" },
			}),
		).toBeGreaterThan(0);
		expect(
			await migration.securityAuditEvent.count({
				where: { actorUserId: owner, action: "AGENT_IDENTITY_SCOPE_DENIED" },
			}),
		).toBeGreaterThan(0);
	});
});

describe("evidence-backed research and drafting", () => {
	test("creates evidence, a proposed finding, drafts, proposals, and review", async () => {
		const ctx = context({ requestId: mailboxRequest, mailboxId: mailbox });
		const evidence = await recordEvidence(ctx, {
			kind: "MAILBOX_MESSAGE",
			locator: `message:${run}`,
			title: "Synthetic evidence",
			observedContent: "Synthetic evidence body that must not be stored",
		});
		const finding = await recordFinding(ctx, {
			evidenceSourceId: evidence.id,
			field: "position",
			summary: "The synthetic record identifies the player as a forward.",
			value: { position: "Forward" },
			confidence: 0.9,
		});
		expect(finding.status).toBe("PROPOSED");
		const draft = await createResearchDraft(ctx, {
			subject: "Synthetic follow-up",
			body: "Unsent synthetic draft",
			idempotencyKey: `draft-${run}`,
		});
		expect(draft.status).toBe("DRAFT");
		const proposal = await createResearchProposal(ctx, {
			title: "Synthetic proposal",
			content: { evidenceSourceId: evidence.id },
			leadId: lead,
			draftId: draft.id,
			idempotencyKey: `proposal-${run}`,
		});
		expect(proposal.status).toBe("DRAFT");
		const review = await submitResearchForReview(ctx, {
			summary: "Synthetic finding ready for a person.",
		});
		expect(review).toMatchObject({ status: "NEEDS_REVIEW", findingCount: 1 });
		expect(
			await migration.evidenceSource.findUnique({ where: { id: evidence.id } }),
		).not.toHaveProperty("observedContent");
	});

	test("is idempotent for draft and proposal creation", async () => {
		const ctx = context({});
		const evidence = await recordEvidence(ctx, {
			kind: "PUBLIC_URL",
			locator: `https://phase5.test/${run}`,
			observedContent: "Synthetic public observation",
		});
		await recordFinding(ctx, {
			evidenceSourceId: evidence.id,
			summary: "Synthetic public finding",
			confidence: 0.8,
		});
		const first = await createResearchDraft(ctx, {
			body: "First immutable synthetic draft",
			idempotencyKey: `same-${run}`,
		});
		const second = await createResearchDraft(ctx, {
			body: "Different retry body",
			idempotencyKey: `same-${run}`,
		});
		expect(second.id).toBe(first.id);
	});
});

describe("durable queue and capability denial", () => {
	test("leases, retries, recovers, and settles mailbox work", async () => {
		const first = await claimResearchRequests(1, `phase5-worker-a-${run}`);
		expect(first[0]).toMatchObject({
			id: queueRequest,
			mailboxId: mailbox,
			attemptCount: 1,
		});
		await settleResearchRequest(queueRequest, "FAILED", "SYNTHETIC_FAILURE");
		let stored = await migration.researchRequest.findUniqueOrThrow({
			where: { id: queueRequest },
		});
		expect(stored).toMatchObject({
			status: "QUEUED",
			failureCode: "SYNTHETIC_FAILURE",
		});
		expect(stored.retryAt).not.toBeNull();
		const premature = await claimResearchRequests(
			100,
			`phase5-too-early-${run}`,
		);
		expect(premature.map((request) => request.id)).not.toContain(queueRequest);

		await migration.researchRequest.update({
			where: { id: queueRequest },
			data: { retryAt: new Date("2000-01-01T00:00:00.000Z") },
		});
		const second = await claimResearchRequests(1, `phase5-worker-b-${run}`);
		expect(second[0]).toMatchObject({ id: queueRequest, attemptCount: 2 });
		const evidence = await migration.evidenceSource.create({
			data: {
				kind: "MANUAL",
				locator: `phase5-queue:${run}`,
				checksum: `phase5-queue-${run}`,
				createdByUserId: owner,
			},
		});
		await migration.researchFinding.create({
			data: {
				requestId: queueRequest,
				evidenceSourceId: evidence.id,
				summary: "Synthetic queue evidence",
				confidence: 1,
			},
		});
		await settleResearchRequest(queueRequest, "NEEDS_REVIEW");
		stored = await migration.researchRequest.findUniqueOrThrow({
			where: { id: queueRequest },
		});
		expect(stored).toMatchObject({
			status: "NEEDS_REVIEW",
			leaseOwner: null,
			leasedUntil: null,
		});
	});

	test("default-denies and durably audits an outbound capability", async () => {
		const before = await migration.securityAuditEvent.count({
			where: { actorUserId: owner, action: "AGENT_CAPABILITY_DENIED" },
		});
		await expect(
			requireIblAgentIdentity(context({}), "email.send"),
		).rejects.toThrow("denied by policy");
		const after = await migration.securityAuditEvent.count({
			where: { actorUserId: owner, action: "AGENT_CAPABILITY_DENIED" },
		});
		expect(after).toBe(before + 1);
	});

	test("audits denied attempts even without a valid claimed user", async () => {
		const before = await migration.securityAuditEvent.count({
			where: { actorUserId: null, action: "AGENT_CAPABILITY_DENIED" },
		});
		await auditDeniedCapability(`missing-${run}`, "smtp.send");
		const after = await migration.securityAuditEvent.count({
			where: { actorUserId: null, action: "AGENT_CAPABILITY_DENIED" },
		});
		expect(after).toBe(before + 1);
	});
});
