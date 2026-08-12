import type { Db } from "@crm/db";
import { ProviderCapabilityError, withPrincipal } from "@crm/db/security";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

@Injectable()
export class OutboundDeliveryService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async queueApprovedDraft(userId: string, draftId: string) {
		return withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			const capability = await tx.providerCapability.findUnique({
				where: { key: "RESEND_OUTBOUND" },
				select: { status: true },
			});
			if (capability?.status !== "VERIFIED") {
				throw new ProviderCapabilityError(
					"RESEND_OUTBOUND",
					"RESEND_OUTBOUND is not verified",
				);
			}
			const draft = await tx.draft.findUnique({
				where: { id: draftId },
				select: {
					id: true,
					status: true,
					ownerUserId: true,
					mailbox: { select: { ownerUserId: true, status: true } },
					recipientRoute: {
						select: {
							id: true,
							type: true,
							contact: { select: { lifecycleState: true } },
						},
					},
					outreachApproval: {
						select: {
							status: true,
							requestedById: true,
							decidedById: true,
							decidedAt: true,
						},
					},
				},
			});
			if (!draft) throw new NotFoundException("Draft not found.");
			if (
				draft.ownerUserId !== userId ||
				draft.mailbox?.ownerUserId !== userId
			) {
				throw new Error("OUTBOUND_SENDER_MISMATCH");
			}
			if (
				draft.status !== "APPROVED" ||
				draft.mailbox?.status !== "VERIFIED" ||
				draft.recipientRoute?.type !== "EMAIL" ||
				draft.recipientRoute.contact?.lifecycleState !== "ACTIVE"
			) {
				throw new Error("OUTBOUND_DRAFT_NOT_SENDABLE");
			}
			if (
				draft.outreachApproval?.status !== "APPROVED" ||
				!draft.outreachApproval.decidedById ||
				!draft.outreachApproval.decidedAt ||
				draft.outreachApproval.decidedById ===
					draft.outreachApproval.requestedById
			) {
				throw new Error("OUTBOUND_APPROVAL_INCOMPLETE");
			}
			const consent = await tx.contactRouteConsent.findUnique({
				where: { routeId: draft.recipientRoute.id },
				select: { status: true },
			});
			if (consent?.status === "DO_NOT_CONTACT") {
				throw new Error("OUTBOUND_ROUTE_DO_NOT_CONTACT");
			}
			const idempotencyKey = "ibl-outbound:" + draft.id;
			const delivery = await tx.outboundDelivery.upsert({
				where: { idempotencyKey },
				create: { draftId: draft.id, idempotencyKey },
				update: {},
				select: { id: true, status: true, providerMessageId: true },
			});
			if (
				["SENT", "DELIVERED", "REPLIED"].includes(delivery.status) &&
				delivery.providerMessageId
			) {
				return { status: delivery.status, duplicate: true };
			}
			await tx.draft.update({
				where: { id: draft.id },
				data: { status: "QUEUED" },
			});
			await tx.domainAuditEvent.create({
				data: {
					actorUserId: userId,
					action: "OUTBOUND_QUEUED",
					entityType: "DRAFT",
					entityId: draft.id,
					outcome: "SUCCESS",
					requestId: idempotencyKey,
				},
			});
			return { status: "QUEUED" as const, deliveryId: delivery.id, duplicate: false };
		});
	}
}