import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OperationsService } from "../apps/api/src/operations/operations.service";
import { PrismaPg } from "../packages/db/node_modules/@prisma/adapter-pg";
import { type Db, PrismaClient } from "../packages/db/src/index";

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const appUrl = process.env.DATABASE_URL;
if (!migrationUrl || !appUrl)
	throw new Error("Phase 3 database URLs are required.");

const migration = new PrismaClient({
	adapter: new PrismaPg({ connectionString: migrationUrl }),
});
const app = new PrismaClient({
	adapter: new PrismaPg({ connectionString: appUrl }),
});
const operations = new OperationsService(app as unknown as Db);
const run = `${Date.now()}`;
const admin = `phase3-admin-${run}`;
const team = `phase3-team-${run}`;
const company = `phase3-company-${run}`;
const player = `phase3-player-${run}`;
const agent = `phase3-agent-${run}`;
const mailbox = `phase3-mailbox-${run}`;

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
	for (const [userId, role] of [
		[admin, "admin"],
		[team, "team"],
	] as const) {
		await migration.user.create({
			data: {
				id: userId,
				name: role,
				email: `${userId}@phase3.test`,
				emailVerified: true,
			},
		});
		await migration.userProfile.create({ data: { userId, status: "ACTIVE" } });
		await migration.member.create({
			data: {
				id: `member-${userId}`,
				organizationId: "workspace",
				userId,
				role,
				createdAt: new Date(),
			},
		});
	}
	await migration.company.create({
		data: { id: company, name: "Phase 3 Club", ownerId: admin },
	});
	await migration.contact.createMany({
		data: [
			{
				id: player,
				firstName: "Phase",
				lastName: "Player",
				companyId: company,
				ownerId: admin,
			},
			{
				id: agent,
				firstName: "Phase",
				lastName: "Agent",
				companyId: company,
				ownerId: admin,
			},
		],
	});
	await migration.mailbox.create({
		data: {
			id: mailbox,
			ownerUserId: admin,
			address: `${mailbox}@phase3.test`,
			normalizedAddress: `${mailbox}@phase3.test`,
			status: "UNVERIFIED",
		},
	});
	await migration.mailboxGrant.create({
		data: {
			id: `phase3-grant-${run}`,
			mailboxId: mailbox,
			granteeUserId: team,
			grantedByUserId: admin,
			permission: "READ",
		},
	});
});

afterAll(async () => {
	await app.$disconnect();
	await migration.$disconnect();
});

describe("operations application service", () => {
	test("creates football profiles and durable representation history", async () => {
		await operations.saveFootballProfile(admin, {
			contactId: player,
			kind: "PLAYER",
			position: "Forward",
		});
		await operations.saveFootballProfile(admin, {
			contactId: agent,
			kind: "FOOTBALL_AGENT",
			licenseNumber: "SYNTHETIC",
		});
		const representation = await operations.createRepresentation(admin, {
			playerContactId: player,
			agentContactId: agent,
			status: "PENDING",
			reason: "Synthetic integration",
		});
		await operations.transitionRepresentation(admin, {
			id: representation.id,
			status: "ACTIVE",
			reason: "Human verification",
		});
		expect(
			await migration.representationHistory.count({
				where: { representationId: representation.id },
			}),
		).toBe(2);
	});

	test("creates linked pipeline work and exposes exact overview counts", async () => {
		const lead = await operations.createLead(admin, {
			name: "Phase 3 lead",
			contactId: player,
			companyId: company,
			ownerUserId: admin,
		});
		const task = await operations.createTask(admin, {
			title: "Phase 3 follow-up",
			assigneeUserId: team,
			contactId: player,
			leadId: lead.id,
			priority: "HIGH",
			idempotencyKey: `phase3-task-${run}`,
		});
		await operations.createNote(admin, {
			body: "Synthetic operational note",
			leadId: lead.id,
		});
		await operations.assign(admin, {
			entityType: "LEAD",
			entityId: lead.id,
			assigneeUserId: team,
			reason: "Work allocation",
		});
		await operations.transitionTask(team, { id: task.id, status: "DONE" });
		const overview = await operations.overview(admin);
		expect(overview.leads).toBeGreaterThanOrEqual(1);
		expect(
			await migration.operationalTask.findUnique({ where: { id: task.id } }),
		).toMatchObject({ status: "DONE" });
	});

	test("creates research, evidence-backed content, and a proposal", async () => {
		const request = await operations.requestResearch(admin, {
			targetType: "CONTACT",
			targetEntityId: player,
			prompt: "Find public synthetic evidence",
			idempotencyKey: `phase3-research-${run}`,
		});
		const lead = await operations.createLead(admin, {
			name: "Phase 3 proposal lead",
			contactId: player,
			ownerUserId: admin,
		});
		const template = await operations.createTemplate(admin, {
			name: `Phase 3 template ${run}`,
			kind: "PROPOSAL",
			body: "Synthetic template",
			shared: false,
		});
		const proof = await operations.createProof(admin, {
			label: "Synthetic proof",
			proofType: "REFERENCE",
			contactId: player,
			reference: "urn:phase3:synthetic",
		});
		const proposal = await operations.createProposal(admin, {
			title: "Phase 3 proposal",
			leadId: lead.id,
			content: { requestId: request.id, proofId: proof.id },
			items: [],
		});
		expect(template.ownerUserId).toBe(admin);
		expect(proposal.title).toBe("Phase 3 proposal");
	});

	test("enforces separate requester and approver for outreach", async () => {
		const route = await operations.createRoute(admin, {
			contactId: player,
			companyId: null,
			type: "EMAIL",
			value: `recipient-${run}@phase3.test`,
			visibility: "PRIVATE",
		});
		const draft = await operations.createDraft(admin, {
			mailboxId: mailbox,
			recipientRouteId: route.id,
			body: "Synthetic draft",
			idempotencyKey: `phase3-draft-${run}`,
		});
		const approval = await operations.requestApproval(admin, {
			draftId: draft.id,
			idempotencyKey: `phase3-approval-${run}`,
		});
		await expect(
			operations.decideApproval(admin, {
				id: approval.id,
				status: "APPROVED",
				reason: "Self approval",
			}),
		).rejects.toThrow();
		await operations.decideApproval(team, {
			id: approval.id,
			status: "APPROVED",
			reason: "Independent review",
		});
		await operations.approveDraft(admin, draft.id);
		expect(
			await migration.draft.findUnique({ where: { id: draft.id } }),
		).toMatchObject({ status: "APPROVED" });
	});
});
