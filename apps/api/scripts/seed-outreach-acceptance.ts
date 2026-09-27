import { db } from "@crm/db";
import { hashPassword } from "better-auth/crypto";

if (process.env.NODE_ENV === "production") {
	throw new Error("Outreach acceptance data cannot be created in production.");
}

const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (
	!(["127.0.0.1", "localhost"] as string[]).includes(databaseUrl.hostname) ||
	databaseUrl.pathname !== "/ibl_outreach_test"
) {
	throw new Error(
		"Outreach acceptance data requires the disposable ibl_outreach_test database on loopback.",
	);
}

const password = process.env.IBL_ACCEPTANCE_PASSWORD;
if (!password || password.length < 12) {
	throw new Error(
		"IBL_ACCEPTANCE_PASSWORD must contain at least 12 characters.",
	);
}

const passwordHash = await hashPassword(password);
const onboardedMetadata = JSON.stringify({
	onboardedAt: new Date().toISOString(),
	fixture: "outreach-acceptance",
});
const people = [
	{
		id: "outreach-admin",
		name: "Outreach Admin",
		email: "admin@local.test",
		role: "admin",
	},
	{
		id: "outreach-team",
		name: "Outreach Team",
		email: "team@local.test",
		role: "team",
	},
	{
		id: "outreach-contributor",
		name: "Outreach Contributor",
		email: "contributor@local.test",
		role: "contributor",
	},
] as const;

await db.$transaction(async (tx) => {
	await tx.organization.upsert({
		where: { id: "workspace" },
		create: {
			id: "workspace",
			name: "IBL Outreach Acceptance",
			slug: "ibl-outreach-acceptance",
			createdAt: new Date(),
			metadata: onboardedMetadata,
			website: "https://local.test",
		},
		update: {
			name: "IBL Outreach Acceptance",
			slug: "ibl-outreach-acceptance",
			metadata: onboardedMetadata,
		},
	});
	for (const person of people) {
		await tx.user.upsert({
			where: { id: person.id },
			create: {
				id: person.id,
				name: person.name,
				email: person.email,
				emailVerified: true,
			},
			update: { name: person.name, email: person.email, emailVerified: true },
		});
		await tx.userProfile.upsert({
			where: { userId: person.id },
			create: { userId: person.id, status: "ACTIVE" },
			update: { status: "ACTIVE", suspendedAt: null },
		});
		await tx.member.upsert({
			where: {
				organizationId_userId: {
					organizationId: "workspace",
					userId: person.id,
				},
			},
			create: {
				id: `member-${person.id}`,
				organizationId: "workspace",
				userId: person.id,
				role: person.role,
				createdAt: new Date(),
			},
			update: { role: person.role },
		});
		await tx.account.upsert({
			where: { id: `credential-${person.id}` },
			create: {
				id: `credential-${person.id}`,
				accountId: person.id,
				providerId: "credential",
				userId: person.id,
				password: passwordHash,
			},
			update: { password: passwordHash },
		});
	}
	await tx.mailbox.upsert({
		where: { normalizedAddress: "contributor@local.test" },
		create: {
			id: "outreach-local-mailbox",
			ownerUserId: "outreach-contributor",
			address: "contributor@local.test",
			normalizedAddress: "contributor@local.test",
			displayName: "Outreach Contributor",
			status: "VERIFIED",
			verifiedAt: new Date(),
		},
		update: {
			ownerUserId: "outreach-contributor",
			status: "VERIFIED",
			verifiedAt: new Date(),
		},
	});
	await tx.contact.upsert({
		where: { id: "outreach-local-contact" },
		create: {
			id: "outreach-local-contact",
			firstName: "Local",
			lastName: "Prospect",
			email: "prospect@local.test",
			ownerId: "outreach-contributor",
		},
		update: { lifecycleState: "ACTIVE", ownerId: "outreach-contributor" },
	});
	await tx.contactRoute.upsert({
		where: { id: "outreach-local-route" },
		create: {
			id: "outreach-local-route",
			contactId: "outreach-local-contact",
			ownerUserId: "outreach-contributor",
			type: "EMAIL",
			value: "prospect@local.test",
			normalizedValue: "prospect@local.test",
			label: "Disposable email",
			visibility: "PRIVATE",
			verifiedAt: new Date(),
		},
		update: { ownerUserId: "outreach-contributor", verifiedAt: new Date() },
	});
	await tx.contactRouteConsent.upsert({
		where: { routeId: "outreach-local-route" },
		create: {
			routeId: "outreach-local-route",
			contactId: "outreach-local-contact",
			status: "ALLOWED",
			reason: "Disposable local acceptance",
			source: "LOCAL_ACCEPTANCE",
			changedByUserId: "outreach-contributor",
			consentedAt: new Date(),
		},
		update: {
			status: "ALLOWED",
			reason: "Disposable local acceptance",
			source: "LOCAL_ACCEPTANCE",
			changedByUserId: "outreach-contributor",
			consentedAt: new Date(),
		},
	});
});

console.log(people.map(({ email, role }) => ({ email, role })));
await db.$disconnect();
