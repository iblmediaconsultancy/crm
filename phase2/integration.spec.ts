import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PrismaPg } from "../packages/db/node_modules/@prisma/adapter-pg";
import { PrismaClient } from "../packages/db/src/index";
import { withPrincipal } from "../packages/db/src/security";

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const appUrl = process.env.DATABASE_URL;
if (!migrationUrl || !appUrl)
	throw new Error("Phase 2 database URLs are required.");

const migration = new PrismaClient({
	adapter: new PrismaPg({ connectionString: migrationUrl }),
});
const app = new PrismaClient({
	adapter: new PrismaPg({ connectionString: appUrl }),
});

const users = {
	admin: "phase2-admin",
	team: "phase2-team",
	contributor: "phase2-contributor",
	outsider: "phase2-outsider",
};
const company = "phase2-company";
const player = "phase2-player";
const agent = "phase2-agent";
const contact = "phase2-contact";
const mailboxAdmin = "phase2-mailbox-admin";
const mailboxTeam = "phase2-mailbox-team";

async function rows<T>(userId: string, sql: string): Promise<T[]> {
	return withPrincipal(app, { userId, kind: "user" }, (tx) =>
		tx.$queryRawUnsafe<T[]>(sql),
	);
}

async function execute(userId: string, sql: string): Promise<number> {
	return withPrincipal(app, { userId, kind: "user" }, (tx) =>
		tx.$executeRawUnsafe(sql),
	);
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
	for (const [roleName, userId] of Object.entries(users)) {
		await migration.user.upsert({
			where: { id: userId },
			create: {
				id: userId,
				name: roleName,
				email: `${userId}@phase2.test`,
				emailVerified: true,
			},
			update: {},
		});
		await migration.userProfile.upsert({
			where: { userId },
			create: { userId, status: "ACTIVE" },
			update: { status: "ACTIVE" },
		});
		if (userId !== users.outsider) {
			await migration.member.upsert({
				where: { id: `member-${userId}` },
				create: {
					id: `member-${userId}`,
					organizationId: "workspace",
					userId,
					role: roleName,
					createdAt: new Date(),
				},
				update: { role: roleName },
			});
		}
	}
	await migration.company.upsert({
		where: { id: company },
		create: { id: company, name: "Phase 2 Club", ownerId: users.admin },
		update: {},
	});
	for (const [id, firstName] of [
		[player, "Player"],
		[agent, "Agent"],
		[contact, "Contact"],
	] as const) {
		await migration.contact.upsert({
			where: { id },
			create: { id, firstName, companyId: company, ownerId: users.admin },
			update: {},
		});
	}
	await migration.footballPlayer.upsert({
		where: { contactId: player },
		create: { contactId: player },
		update: {},
	});
	await migration.footballAgent.upsert({
		where: { contactId: agent },
		create: { contactId: agent },
		update: {},
	});
	for (const [id, ownerUserId] of [
		[mailboxAdmin, users.admin],
		[mailboxTeam, users.team],
	] as const) {
		await migration.mailbox.upsert({
			where: { id },
			create: {
				id,
				ownerUserId,
				address: `${id}@phase2.test`,
				normalizedAddress: `${id}@phase2.test`,
				status: "UNVERIFIED",
			},
			update: { status: "UNVERIFIED", verifiedAt: null },
		});
	}
	await migration.mailboxGrant.upsert({
		where: { id: "phase2-approval-grant" },
		create: {
			id: "phase2-approval-grant",
			mailboxId: mailboxAdmin,
			granteeUserId: users.team,
			grantedByUserId: users.admin,
			permission: "READ",
		},
		update: { revokedAt: null },
	});
});

afterAll(async () => {
	await app.$disconnect();
	await migration.$disconnect();
});

describe("IBL domain integrity", () => {
	test("seeds every legacy pipeline stage and maps existing deals", async () => {
		expect(await migration.pipelineStage.count()).toBe(7);
		expect(
			await migration.deal.count({ where: { pipelineStageId: null } }),
		).toBe(0);
	});

	test("requires player and football-agent profiles", async () => {
		await expect(
			Promise.resolve(
				migration.representation.create({
					data: {
						id: `phase2-invalid-representation-${Date.now()}`,
						playerContactId: player,
						agentContactId: contact,
						createdByUserId: users.admin,
					},
				}),
			),
		).rejects.toThrow(/player and football-agent profiles/i);
	});

	test("prevents concurrent current representations for the same pair", async () => {
		await migration.representation.updateMany({
			where: {
				playerContactId: player,
				agentContactId: agent,
				status: { in: ["PENDING", "ACTIVE"] },
			},
			data: { status: "FORMER", endedAt: new Date() },
		});
		const results = await Promise.allSettled([
			migration.representation.create({
				data: {
					id: `phase2-rep-a-${Date.now()}`,
					playerContactId: player,
					agentContactId: agent,
					status: "ACTIVE",
					createdByUserId: users.admin,
				},
			}),
			migration.representation.create({
				data: {
					id: `phase2-rep-b-${Date.now()}`,
					playerContactId: player,
					agentContactId: agent,
					status: "PENDING",
					createdByUserId: users.admin,
				},
			}),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
	});

	test("rejects orphaned generic assignments", async () => {
		await expect(
			Promise.resolve(
				migration.assignment.create({
					data: {
						id: `phase2-orphan-${Date.now()}`,
						entityType: "CONTACT",
						entityId: "missing-contact",
						assigneeUserId: users.contributor,
						assignedByUserId: users.admin,
					},
				}),
			),
		).rejects.toThrow(/Unknown domain entity|Foreign key constraint/i);
	});

	test("surfaces duplicate candidates without silently merging", async () => {
		const id = `phase2-duplicate-${Date.now()}`;
		await migration.duplicateCandidate.deleteMany({
			where: {
				entityType: "CONTACT",
				leftEntityId: agent < player ? agent : player,
				rightEntityId: agent < player ? player : agent,
			},
		});
		await migration.duplicateCandidate.create({
			data: {
				id,
				entityType: "CONTACT",
				leftEntityId: agent < player ? agent : player,
				rightEntityId: agent < player ? player : agent,
				score: 0.93,
				reasons: ["synthetic-match"],
			},
		});
		expect(
			await migration.duplicateCandidate.findUnique({ where: { id } }),
		).toMatchObject({ status: "OPEN" });
		expect(
			await migration.mergeDecision.count({ where: { candidateId: id } }),
		).toBe(0);
	});
});

describe("IBL forced RLS and human control", () => {
	test("forces RLS on every sensitive Phase 2 table", async () => {
		const sensitiveTables = [
			"footballPlayer",
			"footballAgent",
			"agency",
			"club",
			"contactRoute",
			"sharedRoutePolicy",
			"representation",
			"representationHistory",
			"pipelineStage",
			"lead",
			"operationalTask",
			"note",
			"evidenceSource",
			"proofItem",
			"template",
			"draft",
			"proposal",
			"proposalItem",
			"outreachApproval",
			"assignment",
			"lifecycleEvent",
			"duplicateCandidate",
			"mergeDecision",
			"researchRequest",
			"researchFinding",
			"domainAuditEvent",
		];
		const protectedTables = await migration.$queryRaw<
			Array<{ relname: string }>
		>`
			SELECT relname
			FROM pg_class
			WHERE relnamespace = 'public'::regnamespace
			  AND relrowsecurity
			  AND relforcerowsecurity
		`;
		const protectedNames = new Set(
			protectedTables.map((table) => table.relname),
		);
		expect(
			sensitiveTables.filter((table) => !protectedNames.has(table)),
		).toEqual([]);
	});

	test("keeps private routes owner-only and shared routes read-only", async () => {
		const id = `phase2-route-${Date.now()}`;
		await execute(
			users.admin,
			`INSERT INTO "contactRoute" ("id", "contactId", "ownerUserId", "type", "value", "normalizedValue", "updatedAt") VALUES ('${id}', '${contact}', '${users.admin}', 'EMAIL', 'synthetic@phase2.test', 'synthetic@phase2.test', CURRENT_TIMESTAMP)`,
		);
		expect(
			await rows(
				users.team,
				`SELECT "id" FROM "contactRoute" WHERE "id" = '${id}'`,
			),
		).toHaveLength(0);
		await execute(
			users.admin,
			`UPDATE "contactRoute" SET "visibility" = 'SHARED' WHERE "id" = '${id}'`,
		);
		expect(
			await rows(
				users.team,
				`SELECT "id" FROM "contactRoute" WHERE "id" = '${id}'`,
			),
		).toHaveLength(1);
		expect(
			await execute(
				users.team,
				`UPDATE "contactRoute" SET "label" = 'forbidden' WHERE "id" = '${id}'`,
			),
		).toBe(0);
	});

	test("does not let Admin authority imply mailbox access", async () => {
		const id = `phase2-team-draft-${Date.now()}`;
		await execute(
			users.team,
			`INSERT INTO "draft" ("id", "ownerUserId", "mailboxId", "body", "status", "idempotencyKey", "updatedAt") VALUES ('${id}', '${users.team}', '${mailboxTeam}', 'private synthetic body', 'DRAFT', '${id}', CURRENT_TIMESTAMP)`,
		);
		expect(
			await rows(users.admin, `SELECT "id" FROM "draft" WHERE "id" = '${id}'`),
		).toHaveLength(0);
	});

	test("requires a distinct human approval and keeps unverified Resend fail-closed", async () => {
		const suffix = Date.now();
		const routeId = `phase2-outreach-route-${suffix}`;
		const draftId = `phase2-outreach-draft-${suffix}`;
		const approvalId = `phase2-outreach-approval-${suffix}`;
		await execute(
			users.admin,
			`INSERT INTO "contactRoute" ("id", "contactId", "ownerUserId", "type", "value", "normalizedValue", "updatedAt") VALUES ('${routeId}', '${contact}', '${users.admin}', 'EMAIL', 'approval@phase2.test', 'approval@phase2.test', CURRENT_TIMESTAMP)`,
		);
		await execute(
			users.admin,
			`INSERT INTO "draft" ("id", "ownerUserId", "mailboxId", "recipientRouteId", "body", "status", "idempotencyKey", "updatedAt") VALUES ('${draftId}', '${users.admin}', '${mailboxAdmin}', '${routeId}', 'synthetic outreach', 'DRAFT', '${draftId}', CURRENT_TIMESTAMP)`,
		);
		await execute(
			users.admin,
			`INSERT INTO "outreachApproval" ("id", "draftId", "requestedById", "status", "idempotencyKey") VALUES ('${approvalId}', '${draftId}', '${users.admin}', 'PENDING', '${approvalId}')`,
		);
		await expect(
			execute(
				users.admin,
				`UPDATE "outreachApproval" SET "status" = 'APPROVED', "decidedById" = '${users.admin}', "decidedAt" = CURRENT_TIMESTAMP WHERE "id" = '${approvalId}'`,
			),
		).rejects.toThrow();
		expect(
			await execute(
				users.team,
				`UPDATE "outreachApproval" SET "status" = 'APPROVED', "decidedById" = '${users.team}', "decidedAt" = CURRENT_TIMESTAMP WHERE "id" = '${approvalId}'`,
			),
		).toBe(1);
		expect(
			await execute(
				users.admin,
				`UPDATE "draft" SET "status" = 'APPROVED', "approvedAt" = CURRENT_TIMESTAMP WHERE "id" = '${draftId}'`,
			),
		).toBe(1);
		await expect(
			execute(
				users.admin,
				`UPDATE "draft" SET "status" = 'QUEUED' WHERE "id" = '${draftId}'`,
			),
		).rejects.toThrow(/Resend provider capability is not verified/i);
	});

	test("denies non-members and preserves append-only lifecycle history", async () => {
		expect(
			await rows(users.outsider, `SELECT "contactId" FROM "footballPlayer"`),
		).toHaveLength(0);
		const id = `phase2-lifecycle-${Date.now()}`;
		await execute(
			users.admin,
			`INSERT INTO "lifecycleEvent" ("id", "entityType", "entityId", "toState", "actorUserId") VALUES ('${id}', 'CONTACT', '${contact}', 'QUALIFIED', '${users.admin}')`,
		);
		await expect(
			Promise.resolve(migration.lifecycleEvent.delete({ where: { id } })),
		).rejects.toThrow(/append-only/i);
		await expect(
			Promise.resolve(migration.contact.delete({ where: { id: contact } })),
		).rejects.toThrow(/durable history|Foreign key constraint/i);
	});
});
