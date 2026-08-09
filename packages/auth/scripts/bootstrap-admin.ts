import { hashPassword } from "better-auth/crypto";

if (process.env.NODE_ENV === "production") {
	throw new Error("Local bootstrap is disabled in production.");
}

const email = process.env.IBL_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.IBL_BOOTSTRAP_ADMIN_PASSWORD;
const migrationUrl = process.env.DATABASE_MIGRATION_URL;

if (!email || !password || !migrationUrl) {
	throw new Error(
		"IBL_BOOTSTRAP_ADMIN_EMAIL, IBL_BOOTSTRAP_ADMIN_PASSWORD, and DATABASE_MIGRATION_URL are required.",
	);
}

const url = new URL(migrationUrl);
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
if (!localHosts.has(url.hostname)) {
	throw new Error("Local bootstrap refuses a remote database host.");
}

process.env.DATABASE_URL = migrationUrl;

const [{ db }, { WORKSPACE_ID }] = await Promise.all([
	import("@crm/db"),
	import("@crm/db/workspace"),
]);

const passwordHash = await hashPassword(password);
const now = new Date();

await db.$transaction(async (tx) => {
	const workspace = await tx.organization.upsert({
		where: { id: WORKSPACE_ID },
		create: {
			id: WORKSPACE_ID,
			name: "IBL Media Consultancy",
			slug: "ibl",
			createdAt: now,
		},
		update: { name: "IBL Media Consultancy", slug: "ibl" },
		select: { id: true },
	});
	const user = await tx.user.upsert({
		where: { email },
		create: {
			id: crypto.randomUUID(),
			email,
			name: email.split("@")[0] ?? "IBL Admin",
			emailVerified: true,
		},
		update: { emailVerified: true },
		select: { id: true },
	});
	await tx.userProfile.upsert({
		where: { userId: user.id },
		create: { userId: user.id, status: "ACTIVE", workingPreferences: {} },
		update: { status: "ACTIVE", activatedAt: now, suspendedAt: null },
	});
	await tx.member.upsert({
		where: {
			organizationId_userId: {
				organizationId: workspace.id,
				userId: user.id,
			},
		},
		create: {
			id: crypto.randomUUID(),
			organizationId: workspace.id,
			userId: user.id,
			role: "admin",
			createdAt: now,
		},
		update: { role: "admin" },
	});
	const account = await tx.account.findFirst({
		where: { userId: user.id, providerId: "credential" },
		select: { id: true },
	});
	if (account) {
		await tx.account.update({
			where: { id: account.id },
			data: { accountId: user.id, password: passwordHash },
		});
	} else {
		await tx.account.create({
			data: {
				id: crypto.randomUUID(),
				accountId: user.id,
				providerId: "credential",
				userId: user.id,
				password: passwordHash,
			},
		});
	}
	await tx.securityAuditEvent.create({
		data: {
			actorUserId: user.id,
			action: "LOCAL_ADMIN_BOOTSTRAPPED",
			resourceType: "WorkspaceMember",
			resourceId: user.id,
			outcome: "SUCCEEDED",
		},
	});
});

await db.$disconnect();
console.log("Local IBL Admin bootstrap completed.");
