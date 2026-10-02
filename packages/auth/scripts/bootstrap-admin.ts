import { readFile } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";

const email = process.env.IBL_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const passwordFile = process.env.IBL_BOOTSTRAP_ADMIN_PASSWORD_FILE?.trim();
const migrationUrlFile = process.env.DATABASE_MIGRATION_URL_FILE?.trim();

if (process.argv.length > 2) {
	throw new Error(
		"Bootstrap accepts no command-line configuration or secrets.",
	);
}
if (!email || !passwordFile || !migrationUrlFile) {
	throw new Error(
		"IBL_BOOTSTRAP_ADMIN_EMAIL, IBL_BOOTSTRAP_ADMIN_PASSWORD_FILE, and DATABASE_MIGRATION_URL_FILE are required.",
	);
}
const [password, migrationUrl] = await Promise.all([
	readFile(passwordFile, "utf8").then((value) => value.trim()),
	readFile(migrationUrlFile, "utf8").then((value) => value.trim()),
]);
if (!password || !migrationUrl)
	throw new Error("A bootstrap secret file is empty.");
if (password.length < 12) {
	throw new Error(
		"The bootstrap Admin password file must contain at least 12 characters.",
	);
}

process.env.DATABASE_URL = migrationUrl;

const [{ db }, { WORKSPACE_ID }] = await Promise.all([
	import("@crm/db"),
	import("@crm/db/workspace"),
]);

try {
	const passwordHash = await hashPassword(password);
	const now = new Date();

	await db.$transaction(async (tx) => {
		await tx.$executeRawUnsafe(
			"SELECT pg_advisory_xact_lock(hashtext('ibl-admin-bootstrap'))",
		);
		const activeAdmin = await tx.member.findFirst({
			where: {
				organizationId: WORKSPACE_ID,
				role: "admin",
				user: { profile: { status: "ACTIVE" } },
			},
			select: { id: true },
		});
		if (activeAdmin) {
			throw new Error(
				"Bootstrap refused because an active Admin already exists.",
			);
		}
		const workspace = await tx.organization.upsert({
			where: { id: WORKSPACE_ID },
			create: {
				id: WORKSPACE_ID,
				name: "IBL Media Consultancy",
				slug: "ibl",
				createdAt: now,
			},
			update: {},
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
				action: "ADMIN_BOOTSTRAPPED",
				resourceType: "WorkspaceMember",
				resourceId: user.id,
				outcome: "SUCCEEDED",
				metadata: { environment: process.env.NODE_ENV ?? "unknown" },
			},
		});
	});
	console.log("IBL Admin bootstrap completed.");
} finally {
	await db.$disconnect();
}
