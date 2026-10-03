import { canChangeRole, WORKSPACE_ID, type WorkspaceRole } from "@crm/auth";
import type { Db, Prisma } from "@crm/db";
import {
	ForbiddenException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

type ProfileStatus = "ACTIVE" | "SUSPENDED";

@Injectable()
export class MembershipSecurityService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async setRole(
		actorUserId: string,
		memberId: string,
		role: WorkspaceRole,
	): Promise<void> {
		await this.inWorkspaceTransaction(actorUserId, async (tx) => {
			const target = await this.targetMember(tx, memberId);
			await this.assertRetainsActiveAdmin(tx, target, {
				role,
				status: target.user.profile?.status ?? "ACTIVE",
			});
			await tx.member.update({ where: { id: target.id }, data: { role } });
			await this.audit(tx, actorUserId, "MEMBER_ROLE_CHANGED", target.id, {
				from: target.role,
				to: role,
			});
		});
	}

	async setStatus(
		actorUserId: string,
		memberId: string,
		status: ProfileStatus,
	): Promise<void> {
		await this.inWorkspaceTransaction(actorUserId, async (tx) => {
			const target = await this.targetMember(tx, memberId);
			await this.assertRetainsActiveAdmin(tx, target, {
				role: target.role,
				status,
			});
			await tx.userProfile.update({
				where: { userId: target.userId },
				data: {
					status,
					suspendedAt: status === "SUSPENDED" ? new Date() : null,
					activatedAt:
						status === "ACTIVE" ? new Date() : target.user.profile?.activatedAt,
				},
			});
			if (status === "SUSPENDED") {
				await tx.session.deleteMany({ where: { userId: target.userId } });
				await this.enqueueReallocation(
					tx,
					actorUserId,
					target.userId,
					"MEMBER_SUSPENDED",
				);
			}
			await this.audit(tx, actorUserId, "MEMBER_STATUS_CHANGED", target.id, {
				from: target.user.profile?.status ?? null,
				to: status,
			});
		});
	}

	async removeMember(actorUserId: string, memberId: string): Promise<void> {
		await this.inWorkspaceTransaction(actorUserId, async (tx) => {
			const target = await this.targetMember(tx, memberId);
			await this.assertRetainsActiveAdmin(tx, target, {
				role: "contributor",
				status: "SUSPENDED",
			});
			await tx.userProfile.update({
				where: { userId: target.userId },
				data: { status: "SUSPENDED", suspendedAt: new Date() },
			});
			await tx.session.deleteMany({ where: { userId: target.userId } });
			await this.enqueueReallocation(
				tx,
				actorUserId,
				target.userId,
				"MEMBER_REMOVED",
			);
			await this.audit(tx, actorUserId, "MEMBER_REMOVED", target.id, {
				userId: target.userId,
				sessionsRevoked: true,
			});
		});
	}

	async transferAdmin(
		actorUserId: string,
		replacementMemberId: string,
		previousMemberId: string,
	): Promise<void> {
		await this.inWorkspaceTransaction(actorUserId, async (tx) => {
			const replacement = await this.targetMember(tx, replacementMemberId);
			const previous = await this.targetMember(tx, previousMemberId);
			await tx.userProfile.update({
				where: { userId: replacement.userId },
				data: { status: "ACTIVE", activatedAt: new Date(), suspendedAt: null },
			});
			await tx.member.update({
				where: { id: replacement.id },
				data: { role: "admin" },
			});
			await tx.member.update({
				where: { id: previous.id },
				data: { role: "contributor" },
			});
			await this.audit(tx, actorUserId, "ADMIN_TRANSFERRED", previous.id, {
				replacementMemberId,
			});
		});
	}

	private async inWorkspaceTransaction<T>(
		actorUserId: string,
		run: (tx: Prisma.TransactionClient) => Promise<T>,
	): Promise<T> {
		return this.db.$transaction(async (tx) => {
			const locked = await tx.$queryRaw<{ id: string }[]>`
				SELECT "id" FROM "organization"
				WHERE "id" = ${WORKSPACE_ID}
				FOR UPDATE
			`;
			if (locked.length !== 1) {
				throw new NotFoundException("IBL workspace is not initialized.");
			}
			const actor = await tx.member.findUnique({
				where: {
					organizationId_userId: {
						organizationId: WORKSPACE_ID,
						userId: actorUserId,
					},
				},
				select: {
					role: true,
					user: { select: { profile: { select: { status: true } } } },
				},
			});
			const actorRole =
				actor?.role === "admin" ||
				actor?.role === "team" ||
				actor?.role === "contributor"
					? actor.role
					: null;
			if (
				!canChangeRole(actorRole) ||
				actor?.user.profile?.status !== "ACTIVE"
			) {
				throw new ForbiddenException(
					"Only an active Admin can manage members.",
				);
			}
			return run(tx);
		});
	}

	private async targetMember(tx: Prisma.TransactionClient, memberId: string) {
		const target = await tx.member.findFirst({
			where: { id: memberId, organizationId: WORKSPACE_ID },
			select: {
				id: true,
				userId: true,
				role: true,
				user: { select: { profile: true } },
			},
		});
		if (!target)
			throw new NotFoundException("That person is not in this workspace.");
		return target;
	}

	private async assertRetainsActiveAdmin(
		tx: Prisma.TransactionClient,
		target: Awaited<ReturnType<MembershipSecurityService["targetMember"]>>,
		proposed: { role: string; status: ProfileStatus },
	): Promise<void> {
		const currentlyActiveAdmin =
			target.role === "admin" && target.user.profile?.status === "ACTIVE";
		const remainsActiveAdmin =
			proposed.role === "admin" && proposed.status === "ACTIVE";
		if (!currentlyActiveAdmin || remainsActiveAdmin) return;
		const activeAdmins = await tx.member.count({
			where: {
				organizationId: WORKSPACE_ID,
				role: "admin",
				user: { profile: { status: "ACTIVE" } },
			},
		});
		if (activeAdmins <= 1) {
			throw new ForbiddenException(
				"The workspace must retain at least one active Admin.",
			);
		}
	}

	private async enqueueReallocation(
		tx: Prisma.TransactionClient,
		actorUserId: string,
		assigneeUserId: string,
		reason: string,
	): Promise<void> {
		const assignments = await tx.assignment.findMany({
			where: { assigneeUserId, revokedAt: null },
			select: { id: true, entityType: true, entityId: true },
		});
		if (!assignments.length) return;
		await tx.assignment.updateMany({
			where: { id: { in: assignments.map((assignment) => assignment.id) } },
			data: { revokedAt: new Date() },
		});
		await tx.allocationRequest.createMany({
			data: assignments.map((assignment) => ({
				entityType: assignment.entityType,
				entityId: assignment.entityId,
				requestedByUserId: actorUserId,
				idempotencyKey: `member-reallocation:${assignment.id}`,
				explanation: { reason, previousAssigneeUserId: assigneeUserId },
			})),
			skipDuplicates: true,
		});
	}
	private async audit(
		tx: Prisma.TransactionClient,
		actorUserId: string,
		action: string,
		resourceId: string,
		metadata: Prisma.InputJsonValue,
	): Promise<void> {
		await tx.securityAuditEvent.create({
			data: {
				actorUserId,
				action,
				resourceType: "WorkspaceMember",
				resourceId,
				outcome: "SUCCEEDED",
				metadata,
			},
		});
	}
}
