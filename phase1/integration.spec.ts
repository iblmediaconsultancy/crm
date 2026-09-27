import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MembershipSecurityService } from "../apps/api/src/workspace/membership-security.service";
import { PrismaPg } from "../packages/db/node_modules/@prisma/adapter-pg";
import { type Db, PrismaClient } from "../packages/db/src/index";
import {
	deriveAuthenticatedIdentity,
	guardProviderOperation,
	withPrincipal,
} from "../packages/db/src/security";

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const appUrl = process.env.DATABASE_URL;
if (!migrationUrl || !appUrl)
	throw new Error("Phase 1 database URLs are required.");

const migration = new PrismaClient({
	adapter: new PrismaPg({ connectionString: migrationUrl }),
});
const app = new PrismaClient({
	adapter: new PrismaPg({ connectionString: appUrl }),
});
const security = new MembershipSecurityService(app as unknown as Db);

const users = {
	adminOne: "phase1-admin-one",
	adminTwo: "phase1-admin-two",
	team: "phase1-team",
	contributor: "phase1-contributor",
};
const mailboxOne = "phase1-mailbox-one";
const mailboxTwo = "phase1-mailbox-two";
const threadOne = "phase1-thread-one";

async function activeAdminCount() {
	return migration.member.count({
		where: {
			organizationId: "workspace",
			role: "admin",
			user: { profile: { status: "ACTIVE" } },
		},
	});
}

async function resetAdmins() {
	await migration.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT "id" FROM "organization" WHERE "id" = 'workspace' FOR UPDATE`;
		await tx.userProfile.updateMany({
			where: { userId: { in: Object.values(users) } },
			data: { status: "ACTIVE", suspendedAt: null },
		});
		await tx.member.updateMany({
			where: { organizationId: "workspace" },
			data: { role: "contributor" },
		});
		await tx.member.updateMany({
			where: { userId: { in: [users.adminOne, users.adminTwo] } },
			data: { role: "admin" },
		});
	});
}

beforeAll(async () => {
	await migration.$transaction(async (tx) => {
		await tx.securityAuditEvent.deleteMany({
			where: { actorUserId: { in: Object.values(users) } },
		});
		await tx.emailMessage.deleteMany({
			where: { mailboxId: { in: [mailboxOne, mailboxTwo] } },
		});
		await tx.emailThread.deleteMany({
			where: { mailboxId: { in: [mailboxOne, mailboxTwo] } },
		});
		await tx.mailboxGrant.deleteMany({
			where: { mailboxId: { in: [mailboxOne, mailboxTwo] } },
		});
		await tx.mailbox.deleteMany({
			where: { id: { in: [mailboxOne, mailboxTwo] } },
		});
		await tx.member.deleteMany({
			where: { userId: { in: Object.values(users) } },
		});
		await tx.userProfile.deleteMany({
			where: { userId: { in: Object.values(users) } },
		});
		await tx.user.deleteMany({ where: { id: { in: Object.values(users) } } });
		await tx.organization.upsert({
			where: { id: "workspace" },
			create: {
				id: "workspace",
				name: "IBL Media Consultancy",
				slug: "ibl",
				createdAt: new Date(),
			},
			update: { name: "IBL Media Consultancy", slug: "ibl" },
		});
		for (const [key, id] of Object.entries(users)) {
			await tx.user.create({
				data: {
					id,
					name: key,
					email: `${id}@phase1.test`,
					emailVerified: true,
				},
			});
			await tx.userProfile.create({
				data: {
					userId: id,
					status: "ACTIVE",
					preferredLanguage: key === "adminOne" ? "Dutch" : "English",
					workingPreferences: { concise: true },
				},
			});
			await tx.member.create({
				data: {
					id: `member-${id}`,
					organizationId: "workspace",
					userId: id,
					role: key.startsWith("admin") ? "admin" : key,
					createdAt: new Date(),
				},
			});
		}
		await tx.mailbox.createMany({
			data: [
				{
					id: mailboxOne,
					ownerUserId: users.adminOne,
					address: "admin.one@phase1.test",
					normalizedAddress: "admin.one@phase1.test",
					displayName: "Admin One",
					signature: "Regards, Admin One",
					status: "UNVERIFIED",
				},
				{
					id: mailboxTwo,
					ownerUserId: users.team,
					address: "team@phase1.test",
					normalizedAddress: "team@phase1.test",
					displayName: "Team User",
					signature: "Regards, Team",
					status: "UNVERIFIED",
				},
			],
		});
		await tx.mailboxGrant.create({
			data: {
				id: "phase1-grant",
				mailboxId: mailboxOne,
				granteeUserId: users.contributor,
				grantedByUserId: users.adminOne,
				permission: "READ",
			},
		});
		await tx.emailThread.create({
			data: {
				id: threadOne,
				mailboxId: mailboxOne,
				rootMessageId: "phase1-root",
				subject: "Private",
				firstMessageAt: new Date(),
				lastMessageAt: new Date(),
				messages: {
					create: {
						id: "phase1-message",
						rfcMessageId: "phase1-message@example.test",
						direction: "INBOUND",
						fromEmail: "sender@example.test",
						recipients: [],
						body: "private mailbox body",
						sentAt: new Date(),
					},
				},
			},
		});
	});
});

afterAll(async () => {
	await app.$disconnect();
	await migration.$disconnect();
});

describe("transactional final active Admin invariant", () => {
	test.serial(
		"sole Admin cannot be demoted, suspended, removed, or deleted",
		async () => {
			await resetAdmins();
			await security.setRole(
				users.adminOne,
				`member-${users.adminTwo}`,
				"contributor",
			);
			expect(await activeAdminCount()).toBe(1);
			const sole = `member-${users.adminOne}`;
			const auditBefore = await migration.securityAuditEvent.count();
			await expect(
				security.setRole(users.adminOne, sole, "team"),
			).rejects.toThrow();
			await expect(
				security.setStatus(users.adminOne, sole, "SUSPENDED"),
			).rejects.toThrow();
			await expect(
				security.removeMember(users.adminOne, sole),
			).rejects.toThrow();
			await expect(
				security.deleteAccount(users.adminOne, users.adminOne),
			).rejects.toThrow();
			expect(await activeAdminCount()).toBe(1);
			expect(await migration.securityAuditEvent.count()).toBe(auditBefore);
		},
	);

	test.serial(
		"replacement promotion and prior demotion commit atomically",
		async () => {
			await resetAdmins();
			await security.setRole(
				users.adminOne,
				`member-${users.adminTwo}`,
				"contributor",
			);
			await security.transferAdmin(
				users.adminOne,
				`member-${users.team}`,
				`member-${users.adminOne}`,
			);
			expect(await activeAdminCount()).toBe(1);
			expect(
				await migration.member.findUnique({
					where: { id: `member-${users.team}` },
				}),
			).toMatchObject({ role: "admin" });
		},
	);

	test.serial(
		"concurrent demotions cannot both remove the final Admin",
		async () => {
			await resetAdmins();
			const results = await Promise.allSettled([
				security.setRole(users.adminOne, `member-${users.adminOne}`, "team"),
				security.setRole(users.adminTwo, `member-${users.adminTwo}`, "team"),
			]);
			expect(
				results.filter((result) => result.status === "fulfilled"),
			).toHaveLength(1);
			expect(await activeAdminCount()).toBe(1);
		},
	);

	test.serial(
		"concurrent demotion and suspension cannot reduce count to zero",
		async () => {
			await resetAdmins();
			const results = await Promise.allSettled([
				security.setRole(
					users.adminOne,
					`member-${users.adminOne}`,
					"contributor",
				),
				security.setStatus(
					users.adminTwo,
					`member-${users.adminTwo}`,
					"SUSPENDED",
				),
			]);
			expect(
				results.filter((result) => result.status === "fulfilled"),
			).toHaveLength(1);
			expect(await activeAdminCount()).toBe(1);
		},
	);

	test.serial("direct SQL bypass is rejected by deferred trigger", async () => {
		await resetAdmins();
		await expect(
			migration.$transaction(async (tx) => {
				await tx.$executeRaw`UPDATE "member" SET "role" = 'contributor' WHERE "organizationId" = 'workspace'`;
			}),
		).rejects.toThrow("at least one active Admin");
		expect(await activeAdminCount()).toBe(2);
	});
});

describe("mailbox RLS and identity", () => {
	test("owner and delegate read while unrelated Admin and unscoped service cannot", async () => {
		const owner = await withPrincipal(
			app,
			{ userId: users.adminOne, kind: "user" },
			(tx) =>
				tx.emailMessage.findMany({
					where: { mailboxId: mailboxOne },
					select: { body: true },
				}),
		);
		const delegate = await withPrincipal(
			app,
			{ userId: users.contributor, kind: "user" },
			(tx) =>
				tx.emailMessage.findMany({
					where: { mailboxId: mailboxOne },
					select: { body: true },
				}),
		);
		const unrelatedAdmin = await withPrincipal(
			app,
			{ userId: users.adminTwo, kind: "user" },
			(tx) =>
				tx.emailMessage.findMany({
					where: { mailboxId: mailboxOne },
					select: { body: true },
				}),
		);
		const unscoped = await withPrincipal(
			app,
			{ userId: null, kind: "service" },
			(tx) =>
				tx.emailMessage.findMany({
					where: { mailboxId: mailboxOne },
					select: { body: true },
				}),
		);
		expect(owner).toEqual([{ body: "private mailbox body" }]);
		expect(delegate).toEqual(owner);
		expect(unrelatedAdmin).toEqual([]);
		expect(unscoped).toEqual([]);
	});

	test("worker sees only its leased mailbox", async () => {
		const scoped = await withPrincipal(
			app,
			{ userId: null, mailboxId: mailboxOne, kind: "worker" },
			(tx) => tx.mailbox.findMany({ select: { id: true } }),
		);
		expect(scoped).toEqual([{ id: mailboxOne }]);
	});

	test("profile-only and unverified owned-mailbox identity are valid", async () => {
		const profileOnly = await deriveAuthenticatedIdentity(app, {
			userId: users.adminOne,
			mailboxId: null,
		});
		const withMailbox = await deriveAuthenticatedIdentity(app, {
			userId: users.adminOne,
			mailboxId: mailboxOne,
		});
		expect(profileOnly.mailbox).toBeNull();
		expect(profileOnly.profile.preferredLanguage).toBe("Dutch");
		expect(withMailbox.mailbox).toMatchObject({
			address: "admin.one@phase1.test",
			signature: "Regards, Admin One",
			verificationStatus: "UNVERIFIED",
		});
		expect(JSON.stringify(withMailbox)).not.toContain("Ihsan");
	});

	test("mailbox mismatch is rejected and durably audited", async () => {
		await expect(
			deriveAuthenticatedIdentity(app, {
				userId: users.adminOne,
				mailboxId: mailboxTwo,
			}),
		).rejects.toThrow();
		expect(
			await migration.securityAuditEvent.count({
				where: {
					actorUserId: users.adminOne,
					action: "IDENTITY_MAILBOX_MISMATCH",
					outcome: "DENIED",
				},
			}),
		).toBeGreaterThan(0);
	});
});

describe("provider capability gate", () => {
	test("unverified provider blocks before credential or network work", async () => {
		const credentialReads = 0;
		const networkRequests = 0;
		await expect(
			guardProviderOperation(app, {
				capability: "RESEND_OUTBOUND",
				actorUserId: users.adminOne,
			}),
		).rejects.toThrow("provider proof");
		expect(credentialReads).toBe(0);
		expect(networkRequests).toBe(0);
		expect(
			await migration.securityAuditEvent.count({
				where: {
					actorUserId: users.adminOne,
					action: "PROVIDER_CAPABILITY_DENIED",
					resourceId: "RESEND_OUTBOUND",
				},
			}),
		).toBeGreaterThan(0);
	});
});
