import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type Db, Prisma } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import {
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { Webhook } from "svix";
import { InjectDatabase } from "../database/database.constants";
import { runInPrincipalTransaction } from "../database/database-context";
import { ThreadWriterService } from "../mailbox/thread-writer.service";
import { localProviderDoubleEnabled } from "./local-provider-double";

const CLAIM = `UPDATE "followUpStep" SET "status"='LEASED', "leaseOwner"=$1, "leasedUntil"=NOW()+INTERVAL '60 seconds', "attemptCount"="attemptCount"+1, "updatedAt"=NOW() WHERE "id"=(SELECT s."id" FROM "followUpStep" s JOIN "followUpPlan" p ON p."id"=s."planId" WHERE s."status" IN ('PENDING','LEASED') AND p."status"='ACTIVE' AND s."dueAt"<=NOW() AND (s."retryAt" IS NULL OR s."retryAt"<=NOW()) AND (s."leasedUntil" IS NULL OR s."leasedUntil"<=NOW()) AND s."attemptCount"<s."maxAttempts" ORDER BY s."dueAt",s."id" FOR UPDATE OF s SKIP LOCKED LIMIT 1) RETURNING "id","planId","draftId","attemptCount"`;
type Claim = {
	id: string;
	planId: string;
	draftId: string | null;
	attemptCount: number;
};
type ResendEvent = {
	type: string;
	data?: { email_id?: string };
	created_at?: string;
};

@Injectable()
export class OutreachLifecycleService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly threadWriter?: ThreadWriterService,
	) {}

	async simulateLocalReply(userId: string, deliveryId: string, body: string) {
		if (!localProviderDoubleEnabled() || !this.threadWriter) {
			throw new ConflictException("The local provider double is not enabled.");
		}
		const threadWriter = this.threadWriter;
		const delivery = await withPrincipal(
			this.db,
			{ userId, kind: "user" },
			(tx) =>
				tx.outboundDelivery.findUnique({
					where: { id: deliveryId },
					select: {
						status: true,
						providerMessageId: true,
						draft: {
							select: {
								ownerUserId: true,
								subject: true,
								mailbox: {
									select: {
										id: true,
										ownerUserId: true,
										address: true,
									},
								},
								recipientRoute: {
									select: { normalizedValue: true, contactId: true },
								},
							},
						},
					},
				}),
		);
		if (
			!delivery ||
			delivery.draft.ownerUserId !== userId ||
			!delivery.draft.mailbox ||
			!delivery.draft.recipientRoute ||
			!delivery.providerMessageId ||
			!(["SENT", "DELIVERED"] as string[]).includes(delivery.status)
		) {
			throw new ConflictException(
				"This delivery cannot receive a local reply.",
			);
		}
		const now = new Date();
		const mailbox = delivery.draft.mailbox;
		const recipientRoute = delivery.draft.recipientRoute;
		const providerMessageId = delivery.providerMessageId;
		await runInPrincipalTransaction(
			this.db,
			{ userId: null, mailboxId: mailbox.id, kind: "worker" },
			async () =>
				threadWriter.store(
					{
						id: `local-sync-${mailbox.id}`,
						userId: mailbox.ownerUserId,
						source: "local-double",
						mailboxId: mailbox.id,
						status: "IDLE",
						cursor: null,
						lastSyncedAt: null,
						lastError: null,
						retryAfter: null,
						attemptCount: 0,
						leaseOwner: null,
						lastErrorCode: null,
						autoCreate: false,
						createdAt: now,
						updatedAt: now,
					},
					{
						mailbox: mailbox.address.toLowerCase(),
						origin: "legacy",
						exactContactId: recipientRoute.contactId ?? undefined,
						projectActivity: false,
					},
					{
						rfcMessageId: `<reply-${crypto.randomUUID()}@local.invalid>`,
						rootId: providerMessageId,
						subject: delivery.draft.subject
							? `Re: ${delivery.draft.subject.replace(/^Re:\s*/i, "")}`
							: "Re: Outreach",
						from: {
							email: recipientRoute.normalizedValue,
							name: null,
						},
						recipients: [
							{
								email: mailbox.address.toLowerCase(),
								name: null,
								kind: "to",
							},
						],
						body,
						sentAt: now,
					},
				),
		);
		return { status: "REPLIED" as const };
	}

	async setConsent(
		actor: { userId: string; role: "admin" | "team" | "contributor" },
		input: {
			routeId: string;
			status: "ALLOWED" | "DO_NOT_CONTACT";
			reason: string;
			source: string;
		},
	) {
		return this.db.$transaction(async (tx) => {
			const route = await tx.contactRoute.findUnique({
				where: { id: input.routeId },
				select: { contactId: true, ownerUserId: true, lifecycleState: true },
			});
			if (!route?.contactId || route.lifecycleState !== "ACTIVE")
				throw new NotFoundException("A contact route is required.");
			if (actor.role === "contributor") {
				const assigned =
					route.ownerUserId === actor.userId ||
					Boolean(
						await tx.assignment.findFirst({
							where: {
								entityType: "CONTACT",
								entityId: route.contactId,
								assigneeUserId: actor.userId,
								revokedAt: null,
							},
							select: { id: true },
						}),
					);
				if (!assigned)
					throw new ConflictException(
						"Contributors may change consent only for routes they own or contacts assigned to them.",
					);
			}
			const consent = await tx.contactRouteConsent.upsert({
				where: { routeId: input.routeId },
				create: {
					routeId: input.routeId,
					contactId: route.contactId,
					status: input.status,
					reason: input.reason,
					source: input.source,
					changedByUserId: actor.userId,
					consentedAt: input.status === "ALLOWED" ? new Date() : null,
				},
				update: {
					status: input.status,
					reason: input.reason,
					source: input.source,
					changedByUserId: actor.userId,
					changedAt: new Date(),
					consentedAt: input.status === "ALLOWED" ? new Date() : undefined,
					version: { increment: 1 },
				},
			});
			if (input.status === "DO_NOT_CONTACT")
				await this.cancelForContactTx(
					tx,
					route.contactId,
					`DNC: ${input.reason}`,
				);
			await tx.domainAuditEvent.create({
				data: {
					actorUserId: actor.userId,
					action:
						input.status === "DO_NOT_CONTACT" ? "DNC_SET" : "DNC_RECONSENTED",
					entityType: "CONTACT",
					entityId: route.contactId,
					outcome: "SUCCESS",
					requestId: `consent:${consent.id}:${consent.version}`,
					metadata: {
						routeId: input.routeId,
						reason: input.reason,
						source: input.source,
					},
				},
			});
			return consent;
		});
	}

	async createPlan(
		actorUserId: string,
		input: {
			contactId: string;
			routeId: string;
			leadId?: string | null;
			steps: { dueAt: Date; draftId: string }[];
		},
	) {
		return this.db.$transaction(async (tx) => {
			const route = await tx.contactRoute.findUnique({
				where: { id: input.routeId },
				select: {
					contactId: true,
					ownerUserId: true,
					type: true,
					lifecycleState: true,
					contact: { select: { lifecycleState: true } },
				},
			});
			const consent = await tx.contactRouteConsent.findUnique({
				where: { routeId: input.routeId },
			});
			if (input.leadId) {
				const lead = await tx.lead.findFirst({
					where: { id: input.leadId, contactId: input.contactId },
					select: { id: true },
				});
				if (!lead)
					throw new ConflictException(
						"The follow-up lead does not belong to the contact.",
					);
			}
			if (
				!route ||
				route.lifecycleState !== "ACTIVE" ||
				route.contactId !== input.contactId ||
				route.ownerUserId !== actorUserId ||
				route.type !== "EMAIL" ||
				route.contact?.lifecycleState !== "ACTIVE" ||
				consent?.status === "DO_NOT_CONTACT"
			)
				throw new ConflictException(
					"This route cannot receive a follow-up plan.",
				);
			const drafts = await tx.draft.findMany({
				where: {
					id: { in: input.steps.map((step) => step.draftId) },
					ownerUserId: actorUserId,
					recipientRouteId: input.routeId,
					status: "APPROVED",
					outreachApproval: {
						status: "APPROVED",
						decidedById: { not: actorUserId },
					},
				},
				select: { id: true },
			});
			if (
				drafts.length !== new Set(input.steps.map((step) => step.draftId)).size
			)
				throw new ConflictException(
					"Every follow-up step requires an independently approved draft for this route.",
				);
			const plan = await tx.followUpPlan.create({
				data: {
					contactId: input.contactId,
					routeId: input.routeId,
					ownerUserId: actorUserId,
					leadId: input.leadId ?? null,
					maxSteps: input.steps.length,
					sourceDraftId: input.steps[0]?.draftId,
				},
			});
			await tx.followUpStep.createMany({
				data: input.steps.map((step, position) => ({
					planId: plan.id,
					position,
					dueAt: step.dueAt,
					draftId: step.draftId,
					idempotencyKey: `followup:${plan.id}:${position}`,
				})),
			});
			return tx.followUpPlan.findUniqueOrThrow({ where: { id: plan.id } });
		});
	}

	async listPlans(actor: {
		userId: string;
		role: "admin" | "team" | "contributor";
	}): Promise<
		Array<{
			id: string;
			status: string;
			contactLabel: string;
			routeLabel: string;
			ownerName: string;
			nextDueAt: Date | null;
			pendingSteps: number;
			totalSteps: number;
			cancellationReason: string | null;
		}>
	> {
		const rows = await this.db.followUpPlan.findMany({
			where:
				actor.role === "contributor"
					? { ownerUserId: actor.userId }
					: undefined,
			orderBy: { updatedAt: "desc" },
			take: 100,
			select: {
				id: true,
				status: true,
				cancellationReason: true,
				ownerUserId: true,
				contactId: true,
				routeId: true,
			},
		});
		const ownerIds = [...new Set(rows.map((row) => row.ownerUserId))];
		const contactIds = [...new Set(rows.map((row) => row.contactId))];
		const routeIds = [...new Set(rows.map((row) => row.routeId))];
		const [owners, contacts, routes, steps] = await Promise.all([
			this.db.user.findMany({
				where: { id: { in: ownerIds } },
				select: { id: true, name: true },
			}),
			this.db.contact.findMany({
				where: { id: { in: contactIds } },
				select: { id: true, firstName: true, lastName: true },
			}),
			this.db.contactRoute.findMany({
				where: { id: { in: routeIds } },
				select: { id: true, label: true, value: true },
			}),
			this.db.followUpStep.findMany({
				where: { planId: { in: rows.map((row) => row.id) } },
				orderBy: [{ planId: "asc" }, { position: "asc" }],
				select: { planId: true, status: true, dueAt: true },
			}),
		]);
		const ownerById = new Map(owners.map((owner) => [owner.id, owner.name]));
		const contactById = new Map(
			contacts.map((contact) => [
				contact.id,
				[contact.firstName, contact.lastName].filter(Boolean).join(" "),
			]),
		);
		const routeById = new Map(
			routes.map((route) => [route.id, route.label ?? route.value]),
		);
		const stepsByPlan = new Map<string, typeof steps>();
		for (const step of steps)
			stepsByPlan.set(step.planId, [
				...(stepsByPlan.get(step.planId) ?? []),
				step,
			]);
		return rows.map((row) => {
			const planSteps = stepsByPlan.get(row.id) ?? [];
			const pending = planSteps.filter((step) =>
				["PENDING", "LEASED", "QUEUED"].includes(step.status),
			);
			return {
				id: row.id,
				status: row.status,
				contactLabel: contactById.get(row.contactId) ?? "Archived contact",
				routeLabel: routeById.get(row.routeId) ?? "Unavailable route",
				ownerName: ownerById.get(row.ownerUserId) ?? "Former member",
				nextDueAt: pending[0]?.dueAt ?? null,
				pendingSteps: pending.length,
				totalSteps: planSteps.length,
				cancellationReason: row.cancellationReason,
			};
		});
	}
	async cancelPlan(
		actor: { userId: string; role: "admin" | "team" | "contributor" },
		planId: string,
		reason: string,
	) {
		return this.db.$transaction(async (tx) => {
			const changed = await tx.followUpPlan.updateMany({
				where: {
					id: planId,
					...(actor.role === "contributor"
						? { ownerUserId: actor.userId }
						: {}),
					status: { in: ["ACTIVE", "PAUSED"] },
				},
				data: { status: "CANCELLED", cancellationReason: reason },
			});
			if (changed.count !== 1)
				throw new ConflictException("This follow-up plan cannot be cancelled.");
			await tx.followUpStep.updateMany({
				where: { planId, status: { in: ["PENDING", "LEASED"] } },
				data: { status: "CANCELLED", leaseOwner: null, leasedUntil: null },
			});
			return { id: planId, status: "CANCELLED" as const };
		});
	}

	async cancelForInbound(contactId: string) {
		return this.db.$transaction((tx) =>
			this.cancelForContactTx(tx, contactId, "Inbound reply received"),
		);
	}

	async runDue(workerId: string) {
		let processed = 0;
		for (let i = 0; i < 25; i += 1) {
			const rows = await withPrincipal(
				this.db,
				{ userId: null, kind: "worker" },
				(tx) => tx.$queryRawUnsafe<Claim[]>(CLAIM, workerId),
			);
			const step = rows[0];
			if (!step) break;
			try {
				await this.queueStep(step, workerId);
			} catch (error) {
				await this.failStep(step, workerId, error);
			}
			processed += 1;
		}
		return processed;
	}

	async verifyAndApplyResend(rawBody: string, headers: Record<string, string>) {
		const capability = await this.db.providerCapability.findUnique({
			where: { key: "RESEND_OUTBOUND" },
			select: { status: true },
		});
		if (capability?.status !== "VERIFIED")
			throw new ConflictException("Resend webhook capability is not verified.");
		const secretFile = process.env.RESEND_WEBHOOK_SECRET_FILE?.trim();
		if (!secretFile)
			throw new ConflictException(
				"Resend webhook secret file is not configured.",
			);
		const secret = (await readFile(secretFile, "utf8")).trim();
		const event = new Webhook(secret).verify(rawBody, headers) as ResendEvent;
		const providerEventId = headers["svix-id"];
		const providerMessageId = event.data?.email_id;
		if (!providerEventId || !providerMessageId)
			throw new ConflictException("Webhook identifiers are missing.");
		const status = (
			{
				"email.delivered": "DELIVERED",
				"email.bounced": "BOUNCED",
				"email.complained": "COMPLAINED",
				"email.failed": "FAILED",
			} as const
		)[
			event.type as
				| "email.delivered"
				| "email.bounced"
				| "email.complained"
				| "email.failed"
		];
		if (!status) return { accepted: true, ignored: true };
		return this.db.$transaction(async (tx) => {
			const delivery = await tx.outboundDelivery.findFirst({
				where: { providerMessageId },
				select: {
					id: true,
					draft: {
						select: {
							recipientRouteId: true,
							recipientRoute: { select: { contactId: true } },
						},
					},
				},
			});
			if (!delivery) return { accepted: true, unmatched: true };
			await tx.outreachEvent.upsert({
				where: { providerEventId },
				create: {
					deliveryId: delivery.id,
					eventType: event.type,
					providerEventId,
					providerMessageId,
					occurredAt: event.created_at
						? new Date(event.created_at)
						: new Date(),
					payloadDigest: createHash("sha256").update(rawBody).digest("hex"),
				},
				update: {},
			});
			await tx.outboundDelivery.update({
				where: { id: delivery.id },
				data: { status },
			});
			if (
				(status === "BOUNCED" || status === "COMPLAINED") &&
				delivery.draft.recipientRouteId &&
				delivery.draft.recipientRoute?.contactId
			) {
				await tx.contactRouteConsent.upsert({
					where: { routeId: delivery.draft.recipientRouteId },
					create: {
						routeId: delivery.draft.recipientRouteId,
						contactId: delivery.draft.recipientRoute.contactId,
						status: "DO_NOT_CONTACT",
						reason: status,
						source: "RESEND_WEBHOOK",
					},
					update: {
						status: "DO_NOT_CONTACT",
						reason: status,
						source: "RESEND_WEBHOOK",
						changedAt: new Date(),
						version: { increment: 1 },
					},
				});
				await this.cancelForContactTx(
					tx,
					delivery.draft.recipientRoute.contactId,
					status,
				);
				await tx.contact.update({
					where: { id: delivery.draft.recipientRoute.contactId },
					data: {
						outreachState: "SUPPRESSED",
						outreachStateReason: status,
						outreachStateChangedAt: new Date(),
					},
				});
				await tx.lead.updateMany({
					where: {
						contactId: delivery.draft.recipientRoute.contactId,
						stage: { notIn: ["WON", "LOST"] },
					},
					data: {
						attentionState: "SUPPRESSED",
						blocker: status,
						nextActionAt: null,
						nextActionTitle: null,
					},
				});
			}
			return { accepted: true, deliveryId: delivery.id, status };
		});
	}

	private async queueStep(step: Claim, workerId: string) {
		if (!step.draftId) throw new Error("FOLLOW_UP_DRAFT_MISSING");
		const draftId = step.draftId;
		await withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				const plan = await tx.followUpPlan.findUnique({
					where: { id: step.planId },
				});
				const draft = await tx.draft.findUnique({
					where: { id: draftId },
					select: {
						id: true,
						status: true,
						recipientRoute: {
							select: {
								id: true,
								contactId: true,
								contact: { select: { lifecycleState: true } },
							},
						},
						outreachApproval: { select: { status: true } },
					},
				});
				const consent = draft?.recipientRoute
					? await tx.contactRouteConsent.findUnique({
							where: { routeId: draft.recipientRoute.id },
						})
					: null;
				if (
					plan?.status !== "ACTIVE" ||
					draft?.status !== "APPROVED" ||
					draft.outreachApproval?.status !== "APPROVED" ||
					draft.recipientRoute?.contact?.lifecycleState !== "ACTIVE" ||
					consent?.status === "DO_NOT_CONTACT"
				) {
					await tx.followUpStep.updateMany({
						where: { id: step.id, leaseOwner: workerId },
						data: {
							status: "CANCELLED",
							leaseOwner: null,
							leasedUntil: null,
							lastErrorCode: "FOLLOW_UP_CANCELLED_BY_POLICY",
						},
					});
					if (plan)
						await tx.followUpPlan.update({
							where: { id: plan.id },
							data: {
								status: "CANCELLED",
								cancellationReason: "Policy state changed",
							},
						});
					return;
				}
				await tx.outboundDelivery.upsert({
					where: { idempotencyKey: `followup-delivery:${step.id}` },
					create: {
						draftId: draft.id,
						idempotencyKey: `followup-delivery:${step.id}`,
					},
					update: {},
				});
				await tx.draft.update({
					where: { id: draft.id },
					data: { status: "QUEUED" },
				});
				await tx.followUpStep.updateMany({
					where: { id: step.id, leaseOwner: workerId },
					data: { status: "QUEUED", leaseOwner: null, leasedUntil: null },
				});
			},
		);
	}

	private failStep(step: Claim, workerId: string, error: unknown) {
		const dead = step.attemptCount >= 5;
		return withPrincipal(this.db, { userId: null, kind: "worker" }, (tx) =>
			tx.followUpStep.updateMany({
				where: { id: step.id, leaseOwner: workerId },
				data: {
					status: dead ? "DEAD" : "PENDING",
					leaseOwner: null,
					leasedUntil: null,
					retryAt: dead
						? null
						: new Date(
								Date.now() + Math.min(3600000, 15000 * 2 ** step.attemptCount),
							),
					lastErrorCode:
						error instanceof Error
							? error.message.slice(0, 100)
							: "FOLLOW_UP_FAILED",
				},
			}),
		);
	}

	private async cancelForContactTx(
		tx: Prisma.TransactionClient,
		contactId: string,
		reason: string,
	) {
		const plans = await tx.followUpPlan.findMany({
			where: { contactId, status: { in: ["ACTIVE", "PAUSED"] } },
			select: { id: true },
		});
		const ids = plans.map((plan) => plan.id);
		if (!ids.length) return { cancelled: 0 };
		const steps = await tx.followUpStep.findMany({
			where: { planId: { in: ids }, draftId: { not: null } },
			select: { draftId: true },
		});
		const draftIds = [
			...new Set(steps.flatMap((step) => (step.draftId ? [step.draftId] : []))),
		];
		await tx.followUpPlan.updateMany({
			where: { id: { in: ids } },
			data: { status: "CANCELLED", cancellationReason: reason },
		});
		await tx.followUpStep.updateMany({
			where: {
				planId: { in: ids },
				status: { in: ["PENDING", "LEASED", "QUEUED"] },
			},
			data: { status: "CANCELLED", leaseOwner: null, leasedUntil: null },
		});
		if (draftIds.length) {
			await tx.draft.updateMany({
				where: { id: { in: draftIds }, status: "QUEUED" },
				data: { status: "CANCELLED" },
			});
			await tx.outboundDelivery.updateMany({
				where: {
					draftId: { in: draftIds },
					status: { in: ["PENDING", "RETRY", "SENDING"] },
				},
				data: {
					status: "CANCELLED",
					leaseOwner: null,
					leasedUntil: null,
					lastErrorCode: "FOLLOW_UP_CANCELLED",
				},
			});
		}
		return { cancelled: ids.length };
	}
}
