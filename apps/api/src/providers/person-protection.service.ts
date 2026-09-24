import {
	activePersonProtection,
	type Db,
	MANUAL_IHSAN,
	manualPersonProtectionActorAllowed,
	PERSON_OWNER_PROTECTED,
	Prisma,
} from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import {
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

type ProtectionActor = {
	userId: string;
	role: "admin" | "team" | "contributor";
};

function requireManager(actor: ProtectionActor) {
	if (actor.role === "contributor")
		throw new ConflictException("Manager access is required.");
}

@Injectable()
export class PersonProtectionService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async check(contactId: string) {
		return withPrincipal(this.db, { userId: null, kind: "worker" }, (tx) =>
			activePersonProtection(tx, contactId),
		);
	}

	async activate(
		actor: ProtectionActor,
		input: { contactId: string; reason: string; idempotencyKey: string },
	) {
		requireManager(actor);
		const reason = input.reason.trim();
		const idempotencyKey = input.idempotencyKey.trim();
		if (!reason)
			throw new ConflictException("A protection reason is required.");
		if (!idempotencyKey)
			throw new ConflictException("A protection idempotency key is required.");
		return withPrincipal(
			this.db,
			{ userId: actor.userId, kind: "user" },
			async (tx) => {
				const actorUser = await tx.user.findUnique({
					where: { id: actor.userId },
					select: { id: true, kind: true },
				});
				if (
					!manualPersonProtectionActorAllowed({
						kind: actorUser?.kind ?? "SYSTEM_OPERATOR",
						role: actor.role,
					})
				)
					throw new ConflictException(
						"Only an authorized human owner can activate manual person protection.",
					);
				const contact = await tx.contact.findUnique({
					where: { id: input.contactId },
					select: { id: true },
				});
				if (!contact) throw new NotFoundException("Contact not found.");
				await tx.$executeRaw(
					Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`atlas-person-protection:${contact.id}`}))`,
				);
				const existingRequest = await tx.personProtection.findUnique({
					where: { idempotencyKey },
				});
				if (existingRequest) {
					if (existingRequest.contactId !== contact.id)
						throw new ConflictException(
							"The protection idempotency key belongs to another contact.",
						);
					return existingRequest;
				}
				const active = await tx.personProtection.findFirst({
					where: { contactId: contact.id, status: "ACTIVE" },
					select: { id: true },
				});
				if (active)
					throw new ConflictException(
						"An active person protection already exists for this contact.",
					);
				const protection = await tx.personProtection.create({
					data: {
						contactId: contact.id,
						reason,
						source: MANUAL_IHSAN,
						protectedByUserId: actor.userId,
						idempotencyKey,
					},
				});
				await tx.domainAuditEvent.create({
					data: {
						actorUserId: actor.userId,
						action: "PERSON_PROTECTION_ACTIVATED",
						entityType: "CONTACT",
						entityId: contact.id,
						outcome: "SUCCESS",
						requestId: `person-protection:activated:${protection.id}`,
						metadata: {
							protectionId: protection.id,
							reason,
							source: MANUAL_IHSAN,
							policyReason: PERSON_OWNER_PROTECTED,
						},
					},
				});
				return protection;
			},
		);
	}

	async release(
		actor: ProtectionActor,
		input: { contactId: string; reason: string },
	) {
		requireManager(actor);
		const reason = input.reason.trim();
		if (!reason) throw new ConflictException("A release reason is required.");
		return withPrincipal(
			this.db,
			{ userId: actor.userId, kind: "user" },
			async (tx) => {
				const actorUser = await tx.user.findUnique({
					where: { id: actor.userId },
					select: { id: true, kind: true },
				});
				if (
					!manualPersonProtectionActorAllowed({
						kind: actorUser?.kind ?? "SYSTEM_OPERATOR",
						role: actor.role,
					})
				)
					throw new ConflictException(
						"Only an authorized human owner can release manual person protection.",
					);
				await tx.$executeRaw(
					Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`atlas-person-protection:${input.contactId}`}))`,
				);
				const protection = await tx.personProtection.findFirst({
					where: { contactId: input.contactId },
					orderBy: { createdAt: "desc" },
				});
				if (!protection)
					throw new ConflictException(
						"No person protection exists for this contact.",
					);
				if (protection.status === "RELEASED") return protection;
				const released = await tx.personProtection.update({
					where: { id: protection.id },
					data: {
						status: "RELEASED",
						releasedByUserId: actor.userId,
						releasedAt: new Date(),
						releaseReason: reason,
					},
				});
				await tx.domainAuditEvent.create({
					data: {
						actorUserId: actor.userId,
						action: "PERSON_PROTECTION_RELEASED",
						entityType: "CONTACT",
						entityId: input.contactId,
						outcome: "SUCCESS",
						requestId: `person-protection:released:${released.id}:${released.updatedAt.toISOString()}`,
						metadata: { protectionId: released.id, reason },
					},
				});
				return released;
			},
		);
	}
}
