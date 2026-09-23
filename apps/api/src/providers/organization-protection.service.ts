import { type Db } from "@crm/db";
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

@Injectable()
export class OrganizationProtectionService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async activate(
		actor: ProtectionActor,
		input: { companyId: string; reason: string },
	) {
		if (actor.role === "contributor")
			throw new ConflictException("Manager access is required.");
		const reason = input.reason.trim();
		if (!reason)
			throw new ConflictException("A protection reason is required.");
		return withPrincipal(
			this.db,
			{ userId: actor.userId, kind: "user" },
			async (tx) => {
				const company = await tx.company.findUnique({
					where: { id: input.companyId },
					select: { id: true },
				});
				if (!company) throw new NotFoundException("Organization not found.");
				const idempotencyKey = `manual-org-protection:${company.id}`;
				const existing = await tx.organizationProtection.findUnique({
					where: { idempotencyKey },
				});
				if (existing?.status === "ACTIVE") return existing;
				const protection = existing
					? await tx.organizationProtection.update({
							where: { id: existing.id },
							data: {
								status: "ACTIVE",
								reason,
								source: "MANUAL_IHSAN",
								protectedByUserId: actor.userId,
								protectedAt: new Date(),
								releasedByUserId: null,
								releasedAt: null,
								releaseReason: null,
							},
						})
					: await tx.organizationProtection.create({
							data: {
								companyId: company.id,
								reason,
								source: "MANUAL_IHSAN",
								protectedByUserId: actor.userId,
								idempotencyKey,
							},
						});
				await tx.domainAuditEvent.create({
					data: {
						actorUserId: actor.userId,
						action: "ORGANIZATION_PROTECTION_ACTIVATED",
						entityType: "OUTREACH",
						entityId: protection.id,
						outcome: "SUCCESS",
						requestId: `organization-protection:activated:${protection.id}:${protection.updatedAt.toISOString()}`,
						metadata: { companyId: company.id, reason },
					},
				});
				return protection;
			},
		);
	}

	async release(
		actor: ProtectionActor,
		input: { companyId: string; reason: string },
	) {
		if (actor.role === "contributor")
			throw new ConflictException("Manager access is required.");
		const reason = input.reason.trim();
		if (!reason) throw new ConflictException("A release reason is required.");
		return withPrincipal(
			this.db,
			{ userId: actor.userId, kind: "user" },
			async (tx) => {
				const protection = await tx.organizationProtection.findFirst({
					where: { companyId: input.companyId, status: "ACTIVE" },
				});
				if (!protection)
					throw new ConflictException(
						"No active organization protection exists.",
					);
				const released = await tx.organizationProtection.update({
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
						action: "ORGANIZATION_PROTECTION_RELEASED",
						entityType: "OUTREACH",
						entityId: released.id,
						outcome: "SUCCESS",
						requestId: `organization-protection:released:${released.id}:${released.updatedAt.toISOString()}`,
						metadata: { companyId: input.companyId, reason },
					},
				});
				return released;
			},
		);
	}
}
