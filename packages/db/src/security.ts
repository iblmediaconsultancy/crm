import type { Prisma, ProviderCapabilityKey } from "./generated/prisma/client";

export type PrincipalKind = "user" | "worker" | "service";

export type PrincipalContext = {
	userId: string | null;
	mailboxId?: string | null;
	kind: PrincipalKind;
};

export type WorkspaceRole = "admin" | "team" | "contributor";

export type IdentityEnvelope = {
	principal: {
		userId: string;
		name: string;
		role: WorkspaceRole;
	};
	profile: {
		preferredLanguage: string;
		locale: string;
		timeZone: string;
		workingPreferences: unknown;
	};
	mailbox: null | {
		mailboxId: string;
		address: string;
		displayName: string | null;
		signature: string | null;
		verificationStatus: "DISABLED" | "UNVERIFIED" | "VERIFIED" | "ERROR";
	};
	crmTarget: null | {
		kind: string;
		id: string;
	};
};

export class ProviderCapabilityError extends Error {
	constructor(
		readonly capability: ProviderCapabilityKey,
		message: string,
	) {
		super(message);
		this.name = "ProviderCapabilityError";
	}
}

export async function withPrincipal<T>(
	db: {
		$transaction<R>(
			fn: (tx: Prisma.TransactionClient) => Promise<R>,
		): Promise<R>;
	},
	principal: PrincipalContext,
	run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return db.$transaction(async (tx) => {
		await tx.$executeRaw`SELECT set_config('ibl.user_id', ${principal.userId ?? ""}, true)`;
		await tx.$executeRaw`SELECT set_config('ibl.mailbox_id', ${principal.mailboxId ?? ""}, true)`;
		await tx.$executeRaw`SELECT set_config('ibl.principal_kind', ${principal.kind}, true)`;
		return run(tx);
	});
}

export async function deriveIdentityEnvelope(
	tx: Prisma.TransactionClient,
	input: {
		userId: string;
		mailboxId?: string | null;
		crmTarget?: { kind: string; id: string } | null;
	},
): Promise<IdentityEnvelope> {
	const user = await tx.user.findUnique({
		where: { id: input.userId },
		select: {
			id: true,
			name: true,
			profile: {
				select: {
					status: true,
					preferredLanguage: true,
					locale: true,
					timeZone: true,
					workingPreferences: true,
				},
			},
			members: {
				where: { organizationId: "workspace" },
				select: { role: true },
				take: 1,
			},
		},
	});
	if (!user?.profile || user.profile.status !== "ACTIVE") {
		throw new Error("Authenticated user has no active IBL profile");
	}
	const role = user.members[0]?.role;
	if (role !== "admin" && role !== "team" && role !== "contributor") {
		throw new Error("Authenticated user has no valid IBL workspace role");
	}
	let mailbox: IdentityEnvelope["mailbox"] = null;
	if (input.mailboxId) {
		const row = await tx.mailbox.findFirst({
			where: { id: input.mailboxId, ownerUserId: input.userId },
			select: {
				id: true,
				address: true,
				displayName: true,
				signature: true,
				status: true,
			},
		});
		if (!row) {
			await tx.securityAuditEvent.create({
				data: {
					actorUserId: input.userId,
					action: "IDENTITY_MAILBOX_MISMATCH",
					resourceType: "Mailbox",
					resourceId: input.mailboxId,
					outcome: "DENIED",
				},
			});
			throw new Error("Mailbox does not belong to the authenticated user");
		}
		mailbox = {
			mailboxId: row.id,
			address: row.address,
			displayName: row.displayName,
			signature: row.signature,
			verificationStatus: row.status,
		};
	}
	return {
		principal: { userId: user.id, name: user.name, role },
		profile: {
			preferredLanguage: user.profile.preferredLanguage,
			locale: user.profile.locale,
			timeZone: user.profile.timeZone,
			workingPreferences: user.profile.workingPreferences,
		},
		mailbox,
		crmTarget: input.crmTarget ?? null,
	};
}

export async function requireProviderCapability(
	tx: Prisma.TransactionClient,
	input: {
		capability: ProviderCapabilityKey;
		actorUserId: string;
		mailboxId?: string | null;
	},
): Promise<void> {
	const capability = await tx.providerCapability.findUnique({
		where: { key: input.capability },
		select: { status: true },
	});
	let mailboxVerified = true;
	if (input.capability === "MIAB_IMAP") {
		mailboxVerified = Boolean(
			input.mailboxId &&
				(await tx.mailbox.findFirst({
					where: {
						id: input.mailboxId,
						ownerUserId: input.actorUserId,
						status: "VERIFIED",
					},
					select: { id: true },
				})),
		);
	}
	if (capability?.status !== "VERIFIED" || !mailboxVerified) {
		await tx.securityAuditEvent.create({
			data: {
				actorUserId: input.actorUserId,
				action: "PROVIDER_CAPABILITY_DENIED",
				resourceType: "ProviderCapability",
				resourceId: input.capability,
				outcome: "DENIED",
				metadata: { mailboxId: input.mailboxId ?? null },
			},
		});
		throw new ProviderCapabilityError(
			input.capability,
			`${input.capability} remains unavailable until the Phase 0 provider proof is verified`,
		);
	}
}

export async function deriveAuthenticatedIdentity(
	db: {
		$transaction<R>(
			fn: (tx: Prisma.TransactionClient) => Promise<R>,
		): Promise<R>;
		securityAuditEvent: Prisma.TransactionClient["securityAuditEvent"];
	},
	input: {
		userId: string;
		mailboxId?: string | null;
		crmTarget?: { kind: string; id: string } | null;
	},
): Promise<IdentityEnvelope> {
	try {
		return await withPrincipal(
			db,
			{ userId: input.userId, mailboxId: input.mailboxId, kind: "user" },
			(tx) => deriveIdentityEnvelope(tx, input),
		);
	} catch (error) {
		if (input.mailboxId) {
			await db.securityAuditEvent.create({
				data: {
					actorUserId: input.userId,
					action: "IDENTITY_MAILBOX_MISMATCH",
					resourceType: "Mailbox",
					resourceId: input.mailboxId,
					outcome: "DENIED",
				},
			});
		}
		throw error;
	}
}

export async function guardProviderOperation(
	db: {
		$transaction<R>(
			fn: (tx: Prisma.TransactionClient) => Promise<R>,
		): Promise<R>;
		securityAuditEvent: Prisma.TransactionClient["securityAuditEvent"];
	},
	input: {
		capability: ProviderCapabilityKey;
		actorUserId: string;
		mailboxId?: string | null;
	},
): Promise<void> {
	try {
		await withPrincipal(
			db,
			{ userId: input.actorUserId, mailboxId: input.mailboxId, kind: "user" },
			(tx) => requireProviderCapability(tx, input),
		);
	} catch (error) {
		await db.securityAuditEvent.create({
			data: {
				actorUserId: input.actorUserId,
				action: "PROVIDER_CAPABILITY_DENIED",
				resourceType: "ProviderCapability",
				resourceId: input.capability,
				outcome: "DENIED",
				metadata: { mailboxId: input.mailboxId ?? null },
			},
		});
		throw error;
	}
}
