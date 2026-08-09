import type { Db } from "@crm/db";
import { ProviderCapabilityError, withPrincipal } from "@crm/db/security";
import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type { ResendCredentialSource } from "./provider-credentials";
import {
	EnvironmentResendCredentialSource,
	providerErrorCode,
} from "./provider-credentials";
import { HttpResendTransport, type ResendTransport } from "./resend-transport";

export const RESEND_CREDENTIAL_SOURCE = Symbol("RESEND_CREDENTIAL_SOURCE");
export const RESEND_TRANSPORT = Symbol("RESEND_TRANSPORT");

@Injectable()
export class OutboundDeliveryService {
	private readonly logger = new Logger(OutboundDeliveryService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(RESEND_CREDENTIAL_SOURCE)
		private readonly credentials: ResendCredentialSource,
		@Inject(RESEND_TRANSPORT) private readonly transport: ResendTransport,
	) {}

	async sendApprovedDraft(userId: string, draftId: string) {
		const prepared = await withPrincipal(
			this.db,
			{ userId, kind: "user" },
			async (tx) => {
				const capability = await tx.providerCapability.findUnique({
					where: { key: "RESEND_OUTBOUND" },
					select: { status: true },
				});
				const draft = await tx.draft.findUnique({
					where: { id: draftId },
					select: {
						id: true,
						status: true,
						subject: true,
						body: true,
						ownerUserId: true,
						mailbox: {
							select: {
								id: true,
								ownerUserId: true,
								address: true,
								displayName: true,
								status: true,
							},
						},
						recipientRoute: { select: { type: true, normalizedValue: true } },
						outreachApproval: {
							select: { status: true, decidedById: true, decidedAt: true },
						},
					},
				});
				if (capability?.status !== "VERIFIED")
					throw new ProviderCapabilityError(
						"RESEND_OUTBOUND",
						"RESEND_OUTBOUND is not verified",
					);
				if (!draft) throw new NotFoundException("Draft not found.");
				if (
					draft.ownerUserId !== userId ||
					draft.mailbox?.ownerUserId !== userId
				)
					throw new Error("OUTBOUND_SENDER_MISMATCH");
				if (draft.status !== "APPROVED" && draft.status !== "SENT")
					throw new Error("OUTBOUND_DRAFT_NOT_APPROVED");
				if (draft.mailbox.status !== "VERIFIED")
					throw new Error("OUTBOUND_MAILBOX_NOT_VERIFIED");
				if (draft.recipientRoute?.type !== "EMAIL")
					throw new Error("OUTBOUND_EMAIL_ROUTE_REQUIRED");
				if (
					draft.outreachApproval?.status !== "APPROVED" ||
					!draft.outreachApproval.decidedById ||
					!draft.outreachApproval.decidedAt
				)
					throw new Error("OUTBOUND_APPROVAL_INCOMPLETE");
				const idempotencyKey = `ibl-outbound:${draft.id}`;
				const delivery = await tx.outboundDelivery.upsert({
					where: { idempotencyKey },
					create: { draftId: draft.id, idempotencyKey },
					update: {},
					select: { id: true, status: true, providerMessageId: true },
				});
				if (delivery.status === "SENT" && delivery.providerMessageId)
					return { duplicate: true as const, delivery, draft };
				if (draft.status !== "APPROVED")
					throw new Error("OUTBOUND_DELIVERY_STATE_MISMATCH");
				await tx.outboundDelivery.update({
					where: { id: delivery.id },
					data: {
						status: "SENDING",
						attemptCount: { increment: 1 },
						leaseOwner: userId,
						leasedUntil: new Date(Date.now() + 60_000),
						lastErrorCode: null,
					},
				});
				return { duplicate: false as const, delivery, draft };
			},
		);

		if (prepared.duplicate) {
			return {
				status: "sent" as const,
				providerMessageId: prepared.delivery.providerMessageId,
				duplicate: true,
			};
		}

		try {
			const secret = await this.credentials.load();
			const sent = await this.transport.send(secret.apiKey, {
				from: {
					address: prepared.draft.mailbox?.address ?? "",
					displayName:
						prepared.draft.mailbox?.displayName ?? "IBL Media Consultancy",
				},
				to: prepared.draft.recipientRoute?.normalizedValue ?? "",
				subject: prepared.draft.subject ?? "",
				text: prepared.draft.body,
				idempotencyKey: `ibl-outbound:${prepared.draft.id}`,
			});
			await withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
				const sentAt = new Date();
				await tx.outboundDelivery.update({
					where: { id: prepared.delivery.id },
					data: {
						status: "SENT",
						providerMessageId: sent.providerMessageId,
						sentAt,
						leaseOwner: null,
						leasedUntil: null,
						retryAt: null,
					},
				});
				await tx.draft.update({
					where: { id: prepared.draft.id },
					data: { status: "SENT", sentAt },
				});
				await tx.domainAuditEvent.create({
					data: {
						actorUserId: userId,
						action: "OUTBOUND_SENT",
						entityType: "DRAFT",
						entityId: prepared.draft.id,
						outcome: "SUCCESS",
						requestId: `ibl-outbound:${prepared.draft.id}`,
					},
				});
			});
			this.logger.log({
				message: "Approved outbound delivery completed",
				draftId: prepared.draft.id,
				deliveryId: prepared.delivery.id,
			});
			return {
				status: "sent" as const,
				providerMessageId: sent.providerMessageId,
				duplicate: false,
			};
		} catch (error) {
			const code = providerErrorCode(error);
			await withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
				await tx.outboundDelivery.update({
					where: { id: prepared.delivery.id },
					data: {
						status: "RETRY",
						leaseOwner: null,
						leasedUntil: null,
						retryAt: new Date(Date.now() + 60_000),
						lastErrorCode: code,
					},
				});
				await tx.domainAuditEvent.create({
					data: {
						actorUserId: userId,
						action: "OUTBOUND_FAILED",
						entityType: "DRAFT",
						entityId: prepared.draft.id,
						outcome: "DENIED",
						requestId: `ibl-outbound-failed:${prepared.draft.id}:${prepared.delivery.id}`,
						metadata: { code },
					},
				});
			});
			this.logger.warn({
				message: "Approved outbound delivery failed",
				draftId: prepared.draft.id,
				deliveryId: prepared.delivery.id,
				code,
			});
			throw new Error(code);
		}
	}
}

export const defaultResendProviders = [
	{
		provide: RESEND_CREDENTIAL_SOURCE,
		useClass: EnvironmentResendCredentialSource,
	},
	{ provide: RESEND_TRANSPORT, useValue: new HttpResendTransport() },
];
