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

	async listAtlasAuthorizations(actor: {
		userId: string;
		role: "admin" | "team" | "contributor";
	}) {
		if (actor.role === "contributor")
			throw new ConflictException("Manager access is required.");
		return withPrincipal(
			this.db,
			{ userId: actor.userId, kind: "user" },
			(tx) =>
				tx.outreachAuthorization.findMany({
					where: { scope: "STANDARD_COLD_OUTREACH" },
					orderBy: { issuedAt: "desc" },
					take: 25,
					select: {
						id: true,
						scope: true,
						status: true,
						issuedAt: true,
						expiresAt: true,
						revokedAt: true,
						revocationReason: true,
						authorizedBy: { select: { id: true, name: true } },
						revokedBy: { select: { id: true, name: true } },
					},
				}),
		);
	}

	async issueAtlasAuthorization(
		actor: {
			userId: string;
			role: "admin" | "team" | "contributor";
		},
		input: { expiresAt?: Date | null },
	) {
		if (actor.role === "contributor")
			throw new ConflictException("Manager access is required.");
		const now = new Date();
		if (input.expiresAt && input.expiresAt <= now)
			throw new ConflictException("Authorization expiry must be in the future.");
		return withPrincipal(
			this.db,
			{ userId: actor.userId, kind: "user" },
			async (tx) => {
				await tx.outreachAuthorization.updateMany({
					where: { scope: "STANDARD_COLD_OUTREACH", status: "ACTIVE" },
					data: {
						status: "REVOKED",
						revokedById: actor.userId,
						revokedAt: now,
						revocationReason: "Superseded by a newer authorization",
					},
				});
				const authorization = await tx.outreachAuthorization.create({
					data: {
						authorizedById: actor.userId,
						expiresAt: input.expiresAt ?? null,
					},
				});
				await tx.domainAuditEvent.create({
					data: {
						actorUserId: actor.userId,
						action: "ATLAS_OUTREACH_AUTHORIZATION_ISSUED",
						entityType: "OUTREACH",
						entityId: authorization.id,
						outcome: "SUCCESS",
						requestId: `atlas-authorization:issued:${authorization.id}`,
						metadata: {
							scope: authorization.scope,
							expiresAt: authorization.expiresAt?.toISOString() ?? null,
						},
					},
				});
				return authorization;
			},
		);
	}

	async revokeAtlasAuthorization(
		actor: {
			userId: string;
			role: "admin" | "team" | "contributor";
		},
		input: { id: string; reason: string },
	) {
		if (actor.role === "contributor")
			throw new ConflictException("Manager access is required.");
		const now = new Date();
		return withPrincipal(
			this.db,
			{ userId: actor.userId, kind: "user" },
			async (tx) => {
				const changed = await tx.outreachAuthorization.updateMany({
					where: {
						id: input.id,
						scope: "STANDARD_COLD_OUTREACH",
						status: "ACTIVE",
					},
					data: {
						status: "REVOKED",
						revokedById: actor.userId,
						revokedAt: now,
						revocationReason: input.reason,
					},
				});
				if (changed.count !== 1)
					throw new ConflictException(
						"This authorization is not active or was not found.",
					);
				await tx.domainAuditEvent.create({
					data: {
						actorUserId: actor.userId,
						action: "ATLAS_OUTREACH_AUTHORIZATION_REVOKED",
						entityType: "OUTREACH",
						entityId: input.id,
						outcome: "SUCCESS",
						requestId: `atlas-authorization:revoked:${input.id}:${now.toISOString()}`,
						metadata: { reason: input.reason },
					},
				});
				return { id: input.id, status: "REVOKED" as const };
			},
		);
	}

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
		const storedThread = await withPrincipal(
			this.db,
			{ userId: null, mailboxId: mailbox.id, kind: "worker" },
			(tx) =>
				tx.emailThread.findFirst({
					where: {
						mailboxId: mailbox.id,
						contactId: recipientRoute.contactId,
						subject: delivery.draft.subject,
						messages: { some: { direction: "OUTBOUND" } },
					},
					orderBy: { lastMessageAt: "desc" },
					select: { rootMessageId: true },
				}),
		);
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
						rootId: storedThread?.rootMessageId ?? providerMessageId,
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
				route?.lifecycleState !== "ACTIVE" ||
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

	async materializePendingPlans() {
		return withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				const deliveries = await tx.outboundDelivery.findMany({
					where: {
						status: { in: ["SENT", "DELIVERED"] },
						draft: { coldOutreach: true },
					},
					orderBy: { sentAt: "asc" },
					take: 25,
					select: {
						id: true,
						sentAt: true,
						draft: {
							select: {
								id: true,
								ownerUserId: true,
								mailboxId: true,
								recipientRouteId: true,
								leadId: true,
								authorizationId: true,
								atlasAuthorizedAt: true,
								atlasPolicyVersion: true,
								language: true,
								subject: true,
								body: true,
								recipientRoute: { select: { contactId: true } },
							},
						},
					},
				});
				let created = 0;
				for (const delivery of deliveries) {
					const source = delivery.draft;
					if (
						!delivery.sentAt ||
						!source.mailboxId ||
						!source.recipientRouteId ||
						!source.recipientRoute.contactId ||
						!source.leadId
					)
						continue;
					const existing = await tx.followUpPlan.findUnique({
						where: { sourceDraftId: source.id },
						select: { id: true },
					});
					if (existing) continue;
					const activePlan = await tx.followUpPlan.findFirst({
						where: {
							contactId: source.recipientRoute.contactId,
							status: "ACTIVE",
						},
						select: { id: true },
					});
					if (activePlan) continue;
					const lead = await tx.lead.findUnique({
						where: { id: source.leadId },
						select: { id: true, stage: true, attentionState: true },
					});
					if (
						!lead ||
						[
							"REPLIED",
							"WARM",
							"MEETING",
							"OPPORTUNITY",
							"WON",
							"LOST",
						].includes(lead.stage) ||
						lead.attentionState !== "NONE"
					)
						continue;
					const dueAt = [
						businessDaysAfter(delivery.sentAt, 3, "Europe/Amsterdam"),
						businessDaysAfter(delivery.sentAt, 7, "Europe/Amsterdam"),
					];
					const draftIds: string[] = [];
					for (const position of [1, 2]) {
						const followUpDraft = await tx.draft.upsert({
							where: {
								idempotencyKey: `followup-draft:${source.id}:${position}`,
							},
							create: {
								ownerUserId: source.ownerUserId,
								mailboxId: source.mailboxId,
								recipientRouteId: source.recipientRouteId,
								leadId: source.leadId,
								authorizationId: source.authorizationId,
								atlasAuthorizedAt: source.atlasAuthorizedAt,
								atlasPolicyVersion: source.atlasPolicyVersion,
								coldOutreach: true,
								language: source.language,
								status: "DRAFT",
								subject: followUpSubject(source.subject, position),
								body: followUpBody(source.subject, position, source.language),
								idempotencyKey: `followup-draft:${source.id}:${position}`,
							},
							update: {},
							select: { id: true },
						});
						draftIds.push(followUpDraft.id);
					}
					const plan = await tx.followUpPlan.create({
						data: {
							contactId: source.recipientRoute.contactId,
							routeId: source.recipientRouteId,
							ownerUserId: source.ownerUserId,
							leadId: source.leadId,
							maxSteps: 2,
							sourceDraftId: source.id,
						},
					});
					await tx.followUpStep.createMany({
						data: draftIds.map((draftId, index) => ({
							planId: plan.id,
							position: index,
							dueAt: dueAt[index]!,
							draftId,
							idempotencyKey: `followup:${plan.id}:${index}`,
						})),
					});
					created += 1;
				}
				return { inspected: deliveries.length, created };
			},
		);
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
						coldOutreach: true,
						atlasAuthorizedAt: true,
						authorization: {
							select: { scope: true, status: true, expiresAt: true },
						},
						mailbox: { select: { address: true } },
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
				const settings = draft?.coldOutreach
					? await tx.appSetting.findUnique({
							where: { id: "app" },
							select: { atlasLiveOutreachEnabled: true },
						})
					: null;
				const autonomous = Boolean(
					draft?.coldOutreach &&
					draft.status === "DRAFT" &&
					draft.atlasAuthorizedAt &&
					draft.authorization?.scope === "STANDARD_COLD_OUTREACH" &&
					draft.authorization.status === "ACTIVE" &&
					(draft.authorization.expiresAt === null ||
						draft.authorization.expiresAt > new Date()) &&
					settings?.atlasLiveOutreachEnabled === true &&
					process.env.ATLAS_LIVE_OUTREACH_ENABLED?.trim().toLowerCase() ===
						"true" &&
					draft.mailbox?.address.toLowerCase() === "outreach@iblmedia.com",
				);
				const manuallyApproved = Boolean(
					draft?.status === "APPROVED" &&
					draft.outreachApproval?.status === "APPROVED",
				);
				if (
					plan?.status !== "ACTIVE" ||
					(!manuallyApproved && !autonomous) ||
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
					data: {
						status: "QUEUED",
						approvedAt: autonomous ? new Date() : undefined,
					},
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

export function businessDaysAfter(base: Date, days: number, timeZone: string): Date {
	let candidate = new Date(base);
	let remaining = days;
	while (remaining > 0) {
		candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
		const weekday = new Intl.DateTimeFormat("en-US", {
			timeZone,
			weekday: "short",
		}).format(candidate);
		if (weekday !== "Sat" && weekday !== "Sun") remaining -= 1;
	}
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(candidate);
	const value = (type: string) =>
		parts.find((part) => part.type === type)?.value ?? "00";
	const minutes = Number(value("hour")) * 60 + Number(value("minute"));
	if (minutes >= 9 * 60 && minutes < 18 * 60) return candidate;
	return new Date(
		`${value("year")}-${value("month")}-${value("day")}T10:00:00.000Z`,
	);
}

function followUpSubject(subject: string | null, position: number): string {
	const cleaned = (subject ?? "the earlier note")
		.replace(/^Re:\s*/i, "")
		.replace(/[—–]/g, "-")
		.trim();
	return position === 1 ? `Re: ${cleaned}` : `Re: ${cleaned}`;
}

function followUpBody(subject: string | null, position: number, language?: string | null): string {
	const context = (subject ?? "the earlier note")
		.replace(/^Re:\s*/i, "")
		.replace(/[—–]/g, "-")
		.trim();
	const normalizedLanguage = language?.trim().toLowerCase() ?? "english";
	if (normalizedLanguage === "dutch") {
		return position === 1
			? `Hallo,\n\nEen praktisch punt bij mijn eerdere bericht over ${context}: de ondersteuning kan heel gericht blijven op de momenten die voor een speler tellen, van matchday-content tot een consistent ritme op social media. Als dit al geregeld is, is er misschien een andere speler of media-prioriteit binnen de selectie die relevanter is om te bespreken.\n\nMet vriendelijke groet,\n\nIhsan | Founder, IBL Media Consultancy\niblmedia.com\nWhatsApp: +31 6 27833383`
			: `Hallo,\n\nIk laat dit voorlopig bij je. Als ondersteuning rond ${context} of een andere speler later relevant wordt, stuur ik graag een korte toelichting van hoe we dit bij IBL aanpakken.\n\nMet vriendelijke groet,\n\nIhsan | Founder, IBL Media Consultancy\niblmedia.com\nWhatsApp: +31 6 27833383`;
	}
	if (normalizedLanguage === "turkish") {
		return position === 1
			? `Merhaba,\n\n${context} hakkındaki önceki notuma pratik bir nokta eklemek istedim: destek, oyuncunun önemli anlarına odaklanan maç günü içerikleri ve düzenli sosyal medya akışı kadar hedefli tutulabilir. Bu konu zaten çözülmüşse, kadroda konuşulması daha anlamlı olacak başka bir oyuncu veya medya önceliği var mı?\n\nSaygılarımla,\n\nIhsan | Founder, IBL Media Consultancy\niblmedia.com\nWhatsApp: +31 6 27833383`
			: `Merhaba,\n\nŞimdilik bunu burada bırakayım. ${context} veya başka bir oyuncu için medya desteği ileride faydalı olursa, IBL'in bunu nasıl yürüttüğüne dair kısa bir özet paylaşmaktan memnuniyet duyarım.\n\nSaygılarımla,\n\nIhsan | Founder, IBL Media Consultancy\niblmedia.com\nWhatsApp: +31 6 27833383`;
	}
	return position === 1
		? `Hi,\n\nOne practical point to add to my note about ${context}: the work can stay close to the moments that matter, from matchday content to a consistent account rhythm. If that is already covered, is there another player or current media priority in the roster that would be more useful to discuss?\n\nKind regards,\n\nIhsan | Founder, IBL Media Consultancy\niblmedia.com\nWhatsApp: +31 6 27833383`
		: `Hi,\n\nI will leave this with you for now. If support around ${context} or another player becomes useful, I would be happy to send a short outline of how we handle it at IBL.\n\nKind regards,\n\nIhsan | Founder, IBL Media Consultancy\niblmedia.com\nWhatsApp: +31 6 27833383`;
}
