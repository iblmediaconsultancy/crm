import { stableSystemEmailKey } from "@crm/auth";
import type { Db } from "@crm/db";
import { WORKSPACE_ID } from "@crm/db/workspace";
import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { hashPassword } from "better-auth/crypto";
import type { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import type {
	acceptInvitationInput,
	inviteMemberInput,
	pendingInvitationsInput,
} from "./onboarding.contracts";

@Injectable()
export class OnboardingService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async invitation(invitationId: string) {
		const row = await this.db.invitation.findUnique({
			where: { id: invitationId },
			select: { email: true, role: true, status: true, expiresAt: true },
		});
		if (!row || row.status !== "pending" || row.expiresAt <= new Date()) {
			throw new NotFoundException("This invitation is invalid or has expired.");
		}
		return {
			emailHint: this.maskEmail(row.email),
			role: row.role,
			expiresAt: row.expiresAt,
		};
	}

	async invite(
		actorUserId: string,
		input: z.infer<typeof inviteMemberInput>,
	) {
		const existing = await this.db.user.findUnique({
			where: { email: input.email },
			select: { id: true },
		});
		if (existing) {
			throw new ConflictException(
				"That email already has an account. Reactivate or restore its membership instead.",
			);
		}
		const invitationId = crypto.randomUUID();
		const expiresAt = new Date(
			Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
		);
		const appUrl = (process.env.APP_URL?.split(",")[0] ?? "http://localhost:3000").replace(
			/\/$/,
			"",
		);
		const url = appUrl + "/accept-invitation?id=" + encodeURIComponent(invitationId);
		const key = stableSystemEmailKey("INVITATION", invitationId);
		return this.db.$transaction(async (tx) => {
			await tx.invitation.updateMany({
				where: {
					organizationId: WORKSPACE_ID,
					email: input.email,
					status: "pending",
				},
				data: { status: "canceled" },
			});
			const invitation = await tx.invitation.create({
				data: {
					id: invitationId,
					organizationId: WORKSPACE_ID,
					email: input.email,
					role: input.role,
					status: "pending",
					expiresAt,
					inviterId: actorUserId,
				},
			});
			await tx.systemEmailJob.create({
				data: {
					kind: "INVITATION",
					actorUserId,
					recipientEmail: input.email,
					subject: "Invitation to IBL Command Center",
					textBody: "You were invited to IBL Command Center. Accept the invitation: " + url,
					idempotencyKey: key,
				},
			});
			await tx.securityAuditEvent.create({
				data: {
					actorUserId,
					action: "MEMBER_INVITED",
					resourceType: "Invitation",
					resourceId: invitation.id,
					outcome: "QUEUED",
					metadata: { role: input.role, expiresAt: expiresAt.toISOString() },
				},
			});
			return invitation;
		});
	}

	async pending(input: z.infer<typeof pendingInvitationsInput>) {
		return this.db.invitation.findMany({
			where: {
				organizationId: WORKSPACE_ID,
				status: "pending",
				expiresAt: { gt: new Date() },
			},
			take: input.take,
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				email: true,
				role: true,
				status: true,
				expiresAt: true,
				createdAt: true,
			},
		});
	}

	async resend(actorUserId: string, invitationId: string) {
		const invitation = await this.db.invitation.findFirst({
			where: { id: invitationId, organizationId: WORKSPACE_ID, status: "pending" },
			select: { email: true, role: true },
		});
		if (!invitation || (invitation.role !== "team" && invitation.role !== "contributor")) {
			throw new NotFoundException("Pending invitation not found.");
		}
		return this.invite(actorUserId, { email: invitation.email, role: invitation.role, expiresInDays: 7 });
	}

	async cancel(actorUserId: string, invitationId: string) {
		const result = await this.db.invitation.updateMany({
			where: {
				id: invitationId,
				organizationId: WORKSPACE_ID,
				status: "pending",
			},
			data: { status: "canceled" },
		});
		if (result.count !== 1) throw new NotFoundException("Pending invitation not found.");
		await this.db.securityAuditEvent.create({
			data: {
				actorUserId,
				action: "MEMBER_INVITATION_CANCELLED",
				resourceType: "Invitation",
				resourceId: invitationId,
				outcome: "SUCCEEDED",
			},
		});
		return { invitationId, status: "canceled" };
	}

	async accept(input: z.infer<typeof acceptInvitationInput>) {
		const passwordHash = await hashPassword(input.password);
		const now = new Date();
		return this.db.$transaction(async (tx) => {
			const invitation = await tx.invitation.findUnique({
				where: { id: input.invitationId },
			});
			if (
				!invitation ||
				invitation.organizationId !== WORKSPACE_ID ||
				invitation.status !== "pending" ||
				invitation.expiresAt <= now
			) {
				throw new BadRequestException("This invitation is invalid or has expired.");
			}
			if (invitation.role !== "team" && invitation.role !== "contributor") {
				throw new BadRequestException("This invitation has an invalid role.");
			}
			const existing = await tx.user.findUnique({
				where: { email: invitation.email },
				select: { id: true },
			});
			if (existing) {
				throw new ConflictException(
					"An account already exists for this invitation. Sign in or reset its password.",
				);
			}
			const userId = crypto.randomUUID();
			await tx.user.create({
				data: {
					id: userId,
					name: input.name,
					email: invitation.email,
					emailVerified: true,
				},
			});
			await tx.account.create({
				data: {
					id: crypto.randomUUID(),
					accountId: userId,
					providerId: "credential",
					userId,
					password: passwordHash,
				},
			});
			await tx.userProfile.create({
				data: {
					userId,
					status: "ACTIVE",
					activatedAt: now,
					workingPreferences: {},
				},
			});
			await tx.member.create({
				data: {
					id: crypto.randomUUID(),
					organizationId: WORKSPACE_ID,
					userId,
					role: invitation.role,
					createdAt: now,
				},
			});
			await tx.invitation.update({
				where: { id: invitation.id },
				data: { status: "accepted" },
			});
			await tx.securityAuditEvent.create({
				data: {
					actorUserId: userId,
					action: "INVITATION_ACCEPTED",
					resourceType: "WorkspaceMember",
					resourceId: userId,
					outcome: "SUCCEEDED",
				},
			});
			return { email: invitation.email, accepted: true };
		});
	}

	private maskEmail(email: string): string {
		const [local, domain] = email.split("@");
		if (!local || !domain) return "invited account";
		return local.slice(0, 1) + "***@" + domain;
	}
}