import { db } from "@crm/db";

const ATLAS_USER_ID = "atlas-operator";
const IHSAN_EMAIL = "ihsan@iblmedia.com";
const GOOGLE_PROVIDER_ID = "google-calendar";
const CREDENTIAL_PROVIDER_ID = "credential";

if (process.env.ATLAS_LIVE_OUTREACH_ENABLED?.trim().toLowerCase() === "true")
	throw new Error("ATLAS_LIVE_OUTREACH_ENABLED must remain false.");

const result = await db.$transaction(async (tx) => {
	await tx.$executeRawUnsafe(
		"SELECT pg_advisory_xact_lock(hashtext('ibl-ihsan-owner-migration'))",
	);

	const atlas = await tx.user.findUnique({
		where: { id: ATLAS_USER_ID },
		select: {
			id: true,
			kind: true,
			profile: { select: { status: true } },
			members: {
				where: { organizationId: "workspace" },
				select: { id: true, role: true },
			},
		},
	});
	if (!atlas || atlas.kind !== "SYSTEM_OPERATOR")
		throw new Error("The expected Atlas system operator account was not found.");

	const existing = await tx.user.findUnique({
		where: { email: IHSAN_EMAIL },
		select: { id: true, kind: true },
	});
	if (existing?.kind === "SYSTEM_OPERATOR")
		throw new Error("The Ihsan email is already used by a system operator.");

	const now = new Date();
	const ihsan = existing
		? await tx.user.update({
				where: { id: existing.id },
				data: { kind: "HUMAN", emailVerified: true, name: "Ihsan" },
				select: { id: true, email: true },
			})
		: await tx.user.create({
				data: {
					id: "ihsan-human",
					name: "Ihsan",
					email: IHSAN_EMAIL,
					emailVerified: true,
					kind: "HUMAN",
				},
				select: { id: true, email: true },
			});

	await tx.userProfile.upsert({
		where: { userId: ihsan.id },
		create: {
			userId: ihsan.id,
			status: "ACTIVE",
			workingPreferences: {},
			activatedAt: now,
			suspendedAt: null,
		},
		update: {
			status: "ACTIVE",
			activatedAt: now,
			suspendedAt: null,
		},
	});

	const ihsanMember = await tx.member.upsert({
		where: {
			organizationId_userId: {
				organizationId: "workspace",
				userId: ihsan.id,
			},
		},
		create: {
			id: "ihsan-workspace-member",
			organizationId: "workspace",
			userId: ihsan.id,
			role: "admin",
			createdAt: now,
		},
		update: { role: "admin" },
		select: { id: true },
	});

	const atlasMember = atlas.members[0];
	if (!atlasMember)
		throw new Error("Atlas is not a member of the IBL workspace.");
	await tx.member.update({
		where: { id: atlasMember.id },
		data: { role: "contributor" },
	});

	const [atlasCredential, ihsanCredential] = await Promise.all([
		tx.account.findFirst({
			where: { userId: ATLAS_USER_ID, providerId: CREDENTIAL_PROVIDER_ID },
			select: { id: true },
		}),
		tx.account.findFirst({
			where: { userId: ihsan.id, providerId: CREDENTIAL_PROVIDER_ID },
			select: { id: true },
		}),
	]);
	if (ihsanCredential && atlasCredential)
		throw new Error(
			"Both Atlas and Ihsan already have credential accounts; refusing to merge them.",
		);
	if (atlasCredential && !ihsanCredential) {
		await tx.account.update({
			where: { id: atlasCredential.id },
			data: { userId: ihsan.id, accountId: ihsan.id },
		});
	}

	const [atlasGoogle, ihsanGoogle] = await Promise.all([
		tx.account.findFirst({
			where: { userId: ATLAS_USER_ID, providerId: GOOGLE_PROVIDER_ID },
			select: { id: true },
		}),
		tx.account.findFirst({
			where: { userId: ihsan.id, providerId: GOOGLE_PROVIDER_ID },
			select: { id: true },
		}),
	]);
	if (atlasGoogle && ihsanGoogle)
		throw new Error(
			"Both Atlas and Ihsan already have Google Calendar accounts; refusing to merge them.",
		);
	if (atlasGoogle && !ihsanGoogle) {
		await tx.account.update({
			where: { id: atlasGoogle.id },
			data: {
				userId: ihsan.id,
				accountId: `google-calendar:${ihsan.id}`,
			},
		});
	}

	const sessions = await tx.session.deleteMany({ where: { userId: ATLAS_USER_ID } });
	await tx.securityAuditEvent.createMany({
		data: [
			{
				actorUserId: ATLAS_USER_ID,
				action: "IHSAN_OWNER_ACTIVATED",
				resourceType: "WorkspaceMember",
				resourceId: ihsanMember.id,
				outcome: "SUCCEEDED",
				metadata: { email: IHSAN_EMAIL },
			},
			{
				actorUserId: ATLAS_USER_ID,
				action: "ATLAS_ROLE_RESTRICTED",
				resourceType: "WorkspaceMember",
				resourceId: atlasMember.id,
				outcome: "SUCCEEDED",
				metadata: { role: "contributor", interactiveSessionsRevoked: sessions.count },
			},
			...(atlasGoogle && !ihsanGoogle
				? [
						{
							actorUserId: ATLAS_USER_ID,
							action: "GOOGLE_CALENDAR_ACCOUNT_TRANSFERRED",
							resourceType: "Account",
							resourceId: atlasGoogle.id,
							outcome: "SUCCEEDED",
							metadata: { fromUserId: ATLAS_USER_ID, toUserId: ihsan.id },
						},
					] as const
				: []),
		],
	});

	return {
		ihsanUserId: ihsan.id,
		ihsanMemberId: ihsanMember.id,
		atlasRole: "contributor",
		credentialTransferred: Boolean(atlasCredential && !ihsanCredential),
		googleCalendarTransferred: Boolean(atlasGoogle && !ihsanGoogle),
		atlasSessionsRevoked: sessions.count,
	};
});

console.log(JSON.stringify(result));
await db.$disconnect();
