import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type Db, isPersonProtected, Prisma } from "@crm/db";
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
import {
	atlasRuntimeReadiness,
	evaluateAtlasSystemReadiness,
} from "./atlas-runtime-readiness";
import { followUpAuthorizationDisposition } from "./follow-up-authorization";
import { standardColdFollowUpDueDates } from "./follow-up-cadence";
import {
	FOLLOW_UP_CLAIM_SQL,
	FOLLOW_UP_COHORT_CLAIM_SQL,
} from "./follow-up-claim";
import { evaluateFollowUpCohortCandidate } from "./follow-up-cohort-preflight";
import { localProviderDoubleEnabled } from "./local-provider-double";
import {
	atlasLiveOutreachEnvironmentEnabled,
	atlasScheduledExecutionEnabled,
	followUpClaimAllowed,
} from "./outreach-execution-gates";

export { businessDaysAfter } from "./working-hours";

type Claim = {
	id: string;
	planId: string;
	draftId: string | null;
	attemptCount: number;
	cohortId?: string | null;
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

	async atlasSystemReadiness(actor: {
		userId: string;
		role: "admin" | "team" | "contributor";
	}) {
		if (actor.role === "contributor")
			throw new ConflictException("Manager access is required.");
		const now = new Date();
		const state = await withPrincipal(
			this.db,
			{ userId: actor.userId, kind: "user" },
			async (tx) => {
				const [operator, mailbox, capability, settings, authorization] =
					await Promise.all([
						tx.user.findUnique({
							where: { id: "atlas-operator" },
							select: { kind: true },
						}),
						tx.mailbox.findUnique({
							where: { id: "atlas-outreach-mailbox" },
							select: {
								id: true,
								ownerUserId: true,
								address: true,
								status: true,
							},
						}),
						tx.providerCapability.findUnique({
							where: { key: "RESEND_OUTBOUND" },
							select: { status: true },
						}),
						tx.appSetting.findUnique({
							where: { id: "app" },
							select: { atlasLiveOutreachEnabled: true },
						}),
						tx.outreachAuthorization.findFirst({
							where: {
								scope: "STANDARD_COLD_OUTREACH",
								status: "ACTIVE",
								OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
							},
							orderBy: { issuedAt: "desc" },
							select: { id: true, expiresAt: true },
						}),
					]);
				return { operator, mailbox, capability, settings, authorization };
			},
		);
		const runtime = await atlasRuntimeReadiness();
		return evaluateAtlasSystemReadiness(
			{
				operatorKind: state.operator?.kind ?? null,
				mailbox: state.mailbox,
				providerCapabilityStatus: state.capability?.status ?? null,
				crmLiveOutreachEnabled:
					state.settings?.atlasLiveOutreachEnabled === true,
				authorization: state.authorization,
			},
			runtime,
			process.env.ATLAS_LIVE_OUTREACH_ENABLED?.trim().toLowerCase() === "true",
		);
	}

	async dispatchAtlasOutreach(actor: {
		userId: string;
		role: "admin" | "team" | "contributor";
	}) {
		const readiness = await this.atlasSystemReadiness(actor);
		if (readiness.status !== "READY")
			throw new ConflictException({
				message: "Atlas Email dispatch is blocked by current readiness gates.",
				blockers: readiness.blockers,
			});
		const now = new Date();
		return withPrincipal(
			this.db,
			{ userId: actor.userId, kind: "user" },
			async (tx) => {
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(415084, 1)`;
				const [operator, mailbox, capability, settings, authorization] =
					await Promise.all([
						tx.user.findUnique({
							where: { id: "atlas-operator" },
							select: { kind: true },
						}),
						tx.mailbox.findUnique({
							where: { id: "atlas-outreach-mailbox" },
							select: {
								ownerUserId: true,
								address: true,
								status: true,
							},
						}),
						tx.providerCapability.findUnique({
							where: { key: "RESEND_OUTBOUND" },
							select: { status: true },
						}),
						tx.appSetting.findUnique({
							where: { id: "app" },
							select: { atlasLiveOutreachEnabled: true },
						}),
						tx.outreachAuthorization.findFirst({
							where: {
								scope: "STANDARD_COLD_OUTREACH",
								status: "ACTIVE",
								OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
							},
							orderBy: { issuedAt: "desc" },
							select: { id: true },
						}),
					]);
				if (
					operator?.kind !== "SYSTEM_OPERATOR" ||
					mailbox?.ownerUserId !== "atlas-operator" ||
					mailbox.address.toLowerCase() !== "outreach@iblmedia.com" ||
					mailbox.status !== "VERIFIED" ||
					capability?.status !== "VERIFIED" ||
					!settings?.atlasLiveOutreachEnabled ||
					process.env.ATLAS_LIVE_OUTREACH_ENABLED?.trim().toLowerCase() !==
						"true" ||
					!authorization
				)
					throw new ConflictException(
						"Atlas Email readiness changed before dispatch; refresh and try again.",
					);
				const existing = await tx.agentTask.findFirst({
					where: {
						kind: "atlas-outreach",
						lifecycleState: "ACTIVE",
						finishedAt: null,
					},
					select: { id: true },
				});
				if (existing)
					throw new ConflictException(
						"An Atlas Email cycle is already queued or running.",
					);
				const task = await tx.agentTask.create({
					data: {
						kind: "atlas-outreach",
						reason:
							"Explicitly dispatched from authenticated Atlas Email controls",
						priority: 1000,
						budget: 8,
						dueAt: now,
					},
				});
				await tx.domainAuditEvent.create({
					data: {
						actorUserId: actor.userId,
						action: "ATLAS_OUTREACH_DISPATCH_REQUESTED",
						entityType: "OUTREACH",
						entityId: task.id,
						outcome: "SUCCESS",
						requestId: `atlas-outreach-dispatch:${task.id}`,
						metadata: {
							kind: task.kind,
							authorizationId: authorization.id,
							triggeredBy: "authenticated_ui",
						},
					},
				});
				return { id: task.id, status: "QUEUED" as const };
			},
		);
	}

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
						followUpCohortId: true,
						status: true,
						issuedAt: true,
						expiresAt: true,
						revokedAt: true,
						revocationReason: true,
						authorizedBy: { select: { id: true, name: true } },
						revokedBy: { select: { id: true, name: true } },
						followUpCohort: {
							select: {
								state: true,
								createdAt: true,
								members: { select: { id: true } },
							},
						},
					},
				}),
		);
	}

	async previewFollowUpCohort(actor: {
		userId: string;
		role: "admin" | "team" | "contributor";
	}) {
		if (actor.role === "contributor")
			throw new ConflictException("Manager access is required.");
		const now = new Date();
		return withPrincipal(
			this.db,
			{ userId: actor.userId, kind: "user" },
			async (tx) => {
				const rows = await tx.followUpStep.findMany({
					where: {
						status: "PENDING",
						dueAt: { lte: now },
						plan: { status: "ACTIVE", channel: "EMAIL" },
					},
					orderBy: [{ dueAt: "asc" }, { id: "asc" }],
					take: 501,
					include: {
						plan: { select: { contactId: true } },
						draft: {
							select: {
								recipientRoute: {
									select: {
										value: true,
										contact: {
											select: {
												firstName: true,
												lastName: true,
												company: { select: { name: true } },
											},
										},
									},
								},
							},
						},
					},
				});
				const results = [];
				for (const row of rows.slice(0, 500)) {
					const evaluation = await evaluateFollowUpCohortCandidate(
						tx,
						row.id,
						now,
					);
					results.push({
						id: row.id,
						position: row.position,
						dueAt: row.dueAt,
						canonicalDueAt: evaluation.canonicalDueAt,
						eligible: evaluation.eligible,
						reason: evaluation.reason,
						contactId: row.plan.contactId,
						contactName: [
							row.draft?.recipientRoute?.contact?.firstName,
							row.draft?.recipientRoute?.contact?.lastName,
						]
							.filter(Boolean)
							.join(" "),
						companyName:
							row.draft?.recipientRoute?.contact?.company?.name ?? null,
						route: row.draft?.recipientRoute?.value ?? null,
					});
				}
				return {
					asOf: now,
					truncatedAt: rows.length > 500,
					candidates: results,
					eligibleCount: results.filter((result) => result.eligible).length,
					excludedCount: results.filter((result) => !result.eligible).length,
				};
			},
		);
	}

	async listFollowUpExecutionCohorts(actor: {
		userId: string;
		role: "admin" | "team" | "contributor";
	}) {
		if (actor.role === "contributor")
			throw new ConflictException("Manager access is required.");
		return withPrincipal(
			this.db,
			{ userId: actor.userId, kind: "user" },
			async (tx) => {
				const cohorts = await tx.followUpExecutionCohort.findMany({
					orderBy: { createdAt: "desc" },
					take: 20,
					select: {
						id: true,
						state: true,
						createdAt: true,
						sourceContext: true,
						members: {
							select: {
								followUpStepId: true,
								canonicalDueAt: true,
								status: true,
								blockReason: true,
							},
						},
						authorization: {
							select: {
								id: true,
								status: true,
								issuedAt: true,
								expiresAt: true,
							},
						},
					},
				});
				return cohorts.map((cohort) => {
					const context = cohort.sourceContext;
					const excludedValue =
						context && typeof context === "object" && !Array.isArray(context)
							? context.excluded
							: null;
					const excludedAtPreparation = Array.isArray(excludedValue)
						? excludedValue.filter(
								(row): row is { followUpStepId: string; reason: string } =>
									Boolean(
										row &&
											typeof row === "object" &&
											"followUpStepId" in row &&
											"reason" in row &&
											typeof row.followUpStepId === "string" &&
											typeof row.reason === "string",
									),
							)
						: [];
					return { ...cohort, excludedAtPreparation };
				});
			},
		);
	}

	async prepareFollowUpExecutionCohort(
		actor: { userId: string; role: "admin" | "team" | "contributor" },
		stepIds: string[],
	) {
		if (actor.role === "contributor")
			throw new ConflictException("Manager access is required.");
		if (new Set(stepIds).size !== stepIds.length)
			throw new ConflictException(
				"A follow-up step may only be selected once.",
			);
		const now = new Date();
		return withPrincipal(
			this.db,
			{ userId: actor.userId, kind: "user" },
			async (tx) => {
				await tx.$queryRaw`SELECT pg_advisory_xact_lock(902104, 1)`;
				const members: Array<{ followUpStepId: string; canonicalDueAt: Date }> =
					[];
				const excluded: Array<{ followUpStepId: string; reason: string }> = [];
				for (const id of stepIds) {
					const evaluation = await evaluateFollowUpCohortCandidate(tx, id, now);
					if (!evaluation.eligible || !evaluation.canonicalDueAt) {
						excluded.push({
							followUpStepId: id,
							reason: evaluation.reason ?? "FOLLOW_UP_PREFLIGHT_FAILED",
						});
						continue;
					}
					const alreadyAssigned =
						await tx.followUpExecutionCohortMember.findFirst({
							where: {
								followUpStepId: id,
								status: "PENDING",
								cohort: { state: { in: ["READY", "ACTIVE"] } },
							},
							select: { id: true },
						});
					if (alreadyAssigned) {
						excluded.push({
							followUpStepId: id,
							reason: "EXISTING_EXECUTABLE_COHORT",
						});
						continue;
					}
					members.push({
						followUpStepId: id,
						canonicalDueAt: evaluation.canonicalDueAt,
					});
				}
				const excludedReasons = excluded.reduce<Record<string, number>>(
					(counts, row) => {
						counts[row.reason] = (counts[row.reason] ?? 0) + 1;
						return counts;
					},
					{},
				);
				const cohort = await tx.followUpExecutionCohort.create({
					data: {
						createdById: actor.userId,
						sourceContext: {
							preflightVersion: "follow-up-cohort-v1",
							timeZone: "Europe/Amsterdam",
							createdAt: now.toISOString(),
							requestedStepIds: stepIds,
							includedStepIds: members.map((member) => member.followUpStepId),
							excluded,
						},
					},
				});
				if (members.length)
					await tx.followUpExecutionCohortMember.createMany({
						data: members.map((member) => ({
							...member,
							cohortId: cohort.id,
						})),
					});
				await tx.followUpExecutionCohort.update({
					where: { id: cohort.id },
					data: { state: "READY" },
				});
				const dueTimes = members.map((member) =>
					member.canonicalDueAt.getTime(),
				);
				await tx.domainAuditEvent.create({
					data: {
						actorUserId: actor.userId,
						action: "ATLAS_FOLLOW_UP_COHORT_PREPARED",
						entityType: "OUTREACH",
						entityId: cohort.id,
						outcome: "SUCCESS",
						requestId: `atlas-follow-up-cohort:prepared:${cohort.id}`,
						metadata: {
							requestedCount: stepIds.length,
							selectedCount: members.length,
							excludedCount: excluded.length,
							excludedReasons,
						},
					},
				});
				return {
					id: cohort.id,
					state: "READY" as const,
					requestedCount: stepIds.length,
					selectedCount: members.length,
					excluded,
					earliestDueAt: dueTimes.length
						? new Date(Math.min(...dueTimes))
						: null,
					latestDueAt: dueTimes.length ? new Date(Math.max(...dueTimes)) : null,
				};
			},
		);
	}

	async issueAtlasAuthorization(
		actor: {
			userId: string;
			role: "admin" | "team" | "contributor";
		},
		input: { expiresAt?: Date | null; followUpCohortId?: string | null },
	) {
		if (actor.role === "contributor")
			throw new ConflictException("Manager access is required.");
		const now = new Date();
		if (input.expiresAt && input.expiresAt <= now)
			throw new ConflictException(
				"Authorization expiry must be in the future.",
			);
		return withPrincipal(
			this.db,
			{ userId: actor.userId, kind: "user" },
			async (tx) => {
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(902104, 2)`;
				const cohort = input.followUpCohortId
					? await tx.followUpExecutionCohort.findFirst({
							where: { id: input.followUpCohortId, state: "READY" },
							include: { members: { select: { id: true } } },
						})
					: null;
				if (input.followUpCohortId && (!cohort || cohort.members.length === 0))
					throw new ConflictException(
						"Select a prepared cohort with eligible members.",
					);
				const priorAuthorizations = await tx.outreachAuthorization.findMany({
					where: { scope: "STANDARD_COLD_OUTREACH", status: "ACTIVE" },
					select: { id: true, followUpCohortId: true },
				});
				await tx.outreachAuthorization.updateMany({
					where: { scope: "STANDARD_COLD_OUTREACH", status: "ACTIVE" },
					data: {
						status: "REVOKED",
						revokedById: actor.userId,
						revokedAt: now,
						revocationReason: "Superseded by a newer authorization",
					},
				});
				const priorCohortIds = priorAuthorizations.flatMap((row) =>
					row.followUpCohortId ? [row.followUpCohortId] : [],
				);
				if (priorCohortIds.length)
					await tx.followUpExecutionCohort.updateMany({
						where: { id: { in: priorCohortIds }, state: "ACTIVE" },
						data: { state: "CANCELLED" },
					});
				const authorization = await tx.outreachAuthorization.create({
					data: {
						authorizedById: actor.userId,
						expiresAt: input.expiresAt ?? null,
						followUpCohortId: cohort?.id ?? null,
					},
				});
				if (cohort)
					await tx.followUpExecutionCohort.update({
						where: { id: cohort.id },
						data: { state: "ACTIVE" },
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
							followUpCohortId: cohort?.id ?? null,
							followUpStepCount: cohort?.members.length ?? null,
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
				const authorization = await tx.outreachAuthorization.findFirst({
					where: {
						id: input.id,
						scope: "STANDARD_COLD_OUTREACH",
						status: "ACTIVE",
					},
					select: { followUpCohortId: true },
				});
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
				if (authorization?.followUpCohortId)
					await tx.followUpExecutionCohort.updateMany({
						where: { id: authorization.followUpCohortId, state: "ACTIVE" },
						data: { state: "CANCELLED" },
					});
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
				select: {
					contactId: true,
					ownerUserId: true,
					lifecycleState: true,
					normalizedValue: true,
				},
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
			if (input.status === "ALLOWED" && input.source === "AUDITED_RECONSENT") {
				await tx.suppressedContact.deleteMany({
					where: { email: route.normalizedValue },
				});
				await tx.contact.update({
					where: { id: route.contactId },
					data: {
						outreachState: "ALLOWED",
						outreachStateReason: null,
						outreachStateChangedAt: new Date(),
					},
				});
				if (actor.role !== "contributor") {
					const domain = route.normalizedValue.split("@").at(-1)?.toLowerCase();
					if (domain) {
						await tx.suppressedDomain.deleteMany({ where: { domain } });
						await tx.domainAuditEvent.create({
							data: {
								actorUserId: actor.userId,
								action: "OUTREACH_ORGANIZATION_RECONSENTED",
								entityType: "COMPANY",
								entityId: null,
								outcome: "SUCCESS",
								requestId: `organization-reconsent:${domain}:${consent.version}`,
								metadata: { domain, routeId: input.routeId },
							},
						});
					}
				}
			}
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
			if (await isPersonProtected(tx, input.contactId))
				throw new ConflictException("PERSON_OWNER_PROTECTED");
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
		if (
			!atlasLiveOutreachEnvironmentEnabled() ||
			!atlasScheduledExecutionEnabled()
		)
			return { inspected: 0, created: 0 };
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
								recipientRoute: {
									select: {
										contactId: true,
										contact: { select: { companyId: true } },
									},
								},
							},
						},
					},
				});
				let created = 0;
				for (const delivery of deliveries) {
					const source = delivery.draft;
					const sentAt = delivery.sentAt;
					const recipientRoute = source.recipientRoute;
					if (
						!sentAt ||
						!source.mailboxId ||
						!source.recipientRouteId ||
						!recipientRoute?.contactId ||
						!source.leadId
					)
						continue;
					if (await isPersonProtected(tx, recipientRoute.contactId)) continue;
					const organizationProtection = recipientRoute.contact?.companyId
						? await tx.organizationProtection.findFirst({
								where: {
									companyId: recipientRoute.contact.companyId,
									status: "ACTIVE",
								},
								select: { id: true },
							})
						: null;
					if (organizationProtection) continue;
					const existing = await tx.followUpPlan.findUnique({
						where: { sourceDraftId: source.id },
						select: { id: true },
					});
					if (existing) continue;
					const activePlan = await tx.followUpPlan.findFirst({
						where: {
							contactId: recipientRoute.contactId,
							channel: "EMAIL",
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
					const dueAt = standardColdFollowUpDueDates(
						sentAt,
						"Europe/Amsterdam",
					);
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
							contactId: recipientRoute.contactId,
							channel: "EMAIL",
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
							dueAt: dueAt[index] ?? sentAt,
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
				{
					userId: null,
					kind: "worker",
				},
				async (tx) => {
					const provider = await tx.providerCapability.findUnique({
						where: { key: "RESEND_OUTBOUND" },
						select: { status: true },
					});
					const settings = await tx.appSetting.findUnique({
						where: { id: "app" },
						select: { atlasLiveOutreachEnabled: true },
					});
					const activeCohort = await tx.followUpExecutionCohort.findFirst({
						where: {
							state: { in: ["ACTIVE", "COMPLETED"] },
							authorization: {
								is: { status: "ACTIVE", scope: "STANDARD_COLD_OUTREACH" },
							},
						},
						orderBy: { createdAt: "desc" },
						select: {
							id: true,
							authorization: {
								select: {
									id: true,
									followUpCohortId: true,
									scope: true,
									status: true,
									expiresAt: true,
								},
							},
						},
					});
					const now = new Date();
					const gates = {
						manuallyApproved: false,
						coldDraft: true,
						mailboxAllowed: true,
						hasAuthorizationEvidence: Boolean(activeCohort?.authorization),
						authorizationValid: Boolean(
							activeCohort?.authorization?.scope === "STANDARD_COLD_OUTREACH" &&
								activeCohort.authorization.status === "ACTIVE" &&
								(activeCohort.authorization.expiresAt === null ||
									activeCohort.authorization.expiresAt > now),
						),
						liveOutreachEnabled:
							settings?.atlasLiveOutreachEnabled === true &&
							atlasLiveOutreachEnvironmentEnabled(),
						scheduledExecutionEnabled: atlasScheduledExecutionEnabled(),
						providerReady:
							provider?.status === "VERIFIED" || localProviderDoubleEnabled(),
						cohortBound: Boolean(
							activeCohort?.authorization?.followUpCohortId ===
								activeCohort?.id,
						),
					};
					if (activeCohort) {
						if (!followUpClaimAllowed(gates)) return [];
						return tx.$queryRawUnsafe<Claim[]>(
							FOLLOW_UP_COHORT_CLAIM_SQL,
							workerId,
							activeCohort.id,
							gates.liveOutreachEnabled && gates.scheduledExecutionEnabled,
							localProviderDoubleEnabled(),
						);
					}
					if (!followUpClaimAllowed(gates)) {
						const manualRows = await tx.$queryRawUnsafe<Claim[]>(
							FOLLOW_UP_CLAIM_SQL,
							workerId,
							localProviderDoubleEnabled(),
							false,
							null,
						);
						return manualRows;
					}
					return tx.$queryRawUnsafe<Claim[]>(
						FOLLOW_UP_CLAIM_SQL,
						workerId,
						localProviderDoubleEnabled(),
						false,
						null,
					);
				},
			);
			const step = rows[0];
			if (!step) break;
			try {
				await this.queueStep(step, workerId, step.cohortId ?? null);
			} catch (error) {
				await this.failStep(step, workerId, error, step.cohortId ?? null);
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

	private async queueStep(
		step: Claim,
		workerId: string,
		cohortId: string | null,
	) {
		if (!step.draftId) throw new Error("FOLLOW_UP_DRAFT_MISSING");
		const draftId = step.draftId;
		await withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				let cohortAuthorization: {
					id: string;
					followUpCohortId: string | null;
					scope: string;
					status: string;
					expiresAt: Date | null;
				} | null = null;
				if (cohortId) {
					const member = await tx.followUpExecutionCohortMember.findUnique({
						where: {
							cohortId_followUpStepId: {
								cohortId,
								followUpStepId: step.id,
							},
						},
						include: {
							cohort: {
								include: { authorization: true },
							},
						},
					});
					const activeAt = new Date();
					cohortAuthorization = member?.cohort.authorization ?? null;
					if (
						member?.status !== "PENDING" ||
						member.cohort.state !== "ACTIVE" ||
						!cohortAuthorization ||
						cohortAuthorization.followUpCohortId !== cohortId ||
						cohortAuthorization.scope !== "STANDARD_COLD_OUTREACH" ||
						cohortAuthorization.status !== "ACTIVE" ||
						(cohortAuthorization.expiresAt !== null &&
							cohortAuthorization.expiresAt <= activeAt)
					) {
						await tx.followUpStep.updateMany({
							where: { id: step.id, status: "LEASED", leaseOwner: workerId },
							data: {
								status: "PENDING",
								attemptCount: { decrement: 1 },
								leaseOwner: null,
								leasedUntil: null,
								retryAt: new Date(activeAt.getTime() + 60_000),
								lastErrorCode: "FOLLOW_UP_COHORT_AUTHORIZATION_CHANGED",
							},
						});
						await this.completeCohortIfSettled(tx, cohortId);
						return;
					}
					const evaluation = await evaluateFollowUpCohortCandidate(
						tx,
						step.id,
						activeAt,
						{ type: "CLAIMED", workerId },
					);
					if (!evaluation.eligible) {
						const reason =
							evaluation.reason ?? "FOLLOW_UP_EXECUTION_PREFLIGHT_FAILED";
						await tx.followUpStep.updateMany({
							where: { id: step.id, status: "LEASED", leaseOwner: workerId },
							data: {
								status: "CANCELLED",
								leaseOwner: null,
								leasedUntil: null,
								lastErrorCode: reason,
							},
						});
						await tx.followUpExecutionCohortMember.updateMany({
							where: { cohortId, followUpStepId: step.id, status: "PENDING" },
							data: { status: "BLOCKED", blockReason: reason },
						});
						await tx.followUpPlan.updateMany({
							where: { id: step.planId, status: "ACTIVE" },
							data: { status: "CANCELLED", cancellationReason: reason },
						});
						await tx.domainAuditEvent.create({
							data: {
								action: "ATLAS_FOLLOW_UP_COHORT_MEMBER_BLOCKED",
								entityType: "OUTREACH",
								entityId: step.id,
								outcome: "BLOCKED",
								requestId: `atlas-follow-up-cohort:blocked:${cohortId}:${step.id}`,
								metadata: { cohortId, reason },
							},
						});
						return;
					}
				}
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
								contact: {
									select: { lifecycleState: true, companyId: true },
								},
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
				const personProtected = draft?.recipientRoute?.contactId
					? await isPersonProtected(tx, draft.recipientRoute.contactId)
					: false;
				const activeLinkedInConversation = draft?.recipientRoute?.contactId
					? await tx.channelEngagementState.findFirst({
							where: {
								contactId: draft.recipientRoute.contactId,
								channel: "LINKEDIN",
								status: { in: ["ACTIVE_HUMAN_CONVERSATION", "NEEDS_IHSAN"] },
							},
							select: { id: true },
						})
					: null;
				const organizationProtection = draft?.coldOutreach
					? await tx.organizationProtection.findFirst({
							where: {
								companyId: draft.recipientRoute?.contact?.companyId ?? "",
								status: "ACTIVE",
							},
							select: { id: true },
						})
					: null;
				const settings = draft?.coldOutreach
					? await tx.appSetting.findUnique({
							where: { id: "app" },
							select: { atlasLiveOutreachEnabled: true },
						})
					: null;
				const storedAuthorizationValid = Boolean(
					draft?.authorization &&
						draft.authorization.scope === "STANDARD_COLD_OUTREACH" &&
						draft.authorization.status === "ACTIVE" &&
						(draft.authorization.expiresAt === null ||
							draft.authorization.expiresAt > new Date()),
				);
				const currentAuthorization = cohortId
					? cohortAuthorization
					: draft?.coldOutreach &&
							draft.status === "DRAFT" &&
							!storedAuthorizationValid
						? await tx.outreachAuthorization.findFirst({
								where: {
									scope: "STANDARD_COLD_OUTREACH",
									status: "ACTIVE",
									OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
								},
								orderBy: { issuedAt: "desc" },
								select: {
									id: true,
									scope: true,
									status: true,
									expiresAt: true,
								},
							})
						: null;
				const effectiveAuthorization =
					currentAuthorization ?? draft?.authorization;
				const authorizationValid = Boolean(
					effectiveAuthorization?.scope === "STANDARD_COLD_OUTREACH" &&
						effectiveAuthorization.status === "ACTIVE" &&
						(effectiveAuthorization.expiresAt === null ||
							effectiveAuthorization.expiresAt > new Date()),
				);
				const liveOutreachEnabled =
					settings?.atlasLiveOutreachEnabled === true &&
					process.env.ATLAS_LIVE_OUTREACH_ENABLED?.trim().toLowerCase() ===
						"true";
				const mailboxAllowed =
					draft?.mailbox?.address.toLowerCase() === "outreach@iblmedia.com";
				const hasAuthorizationEvidence = Boolean(
					draft?.atlasAuthorizedAt || currentAuthorization,
				);
				const manuallyApproved = Boolean(
					draft?.status === "APPROVED" &&
						draft.outreachApproval?.status === "APPROVED",
				);
				const authorizationDisposition = followUpAuthorizationDisposition({
					manuallyApproved,
					coldDraft: Boolean(draft?.coldOutreach && draft.status === "DRAFT"),
					mailboxAllowed,
					hasAuthorizationEvidence,
					authorizationValid,
					liveOutreachEnabled,
				});
				const autonomous =
					authorizationDisposition === "READY" && !manuallyApproved;
				if (
					!draft ||
					plan?.channel !== "EMAIL" ||
					plan?.status !== "ACTIVE" ||
					personProtected ||
					activeLinkedInConversation ||
					organizationProtection ||
					authorizationDisposition === "CANCEL" ||
					draft.recipientRoute?.contact?.lifecycleState !== "ACTIVE" ||
					consent?.status === "DO_NOT_CONTACT"
				) {
					const cohortBlockReason = personProtected
						? "PERSON_OWNER_PROTECTED"
						: organizationProtection
							? "FOLLOW_UP_CANCELLED_BY_ORGANIZATION_OWNER_PROTECTION"
							: "FOLLOW_UP_CANCELLED_BY_POLICY";
					await tx.followUpStep.updateMany({
						where: { id: step.id, leaseOwner: workerId },
						data: {
							status: "CANCELLED",
							leaseOwner: null,
							leasedUntil: null,
							lastErrorCode: cohortBlockReason,
						},
					});
					if (cohortId)
						await tx.followUpExecutionCohortMember.updateMany({
							where: {
								cohortId,
								followUpStepId: step.id,
								status: "PENDING",
							},
							data: { status: "BLOCKED", blockReason: cohortBlockReason },
						});
					if (cohortId) await this.completeCohortIfSettled(tx, cohortId);
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
				if (
					authorizationDisposition === "WAIT" ||
					(cohortId !== null && !atlasScheduledExecutionEnabled())
				) {
					const holdReason =
						cohortId !== null && !atlasScheduledExecutionEnabled()
							? "ATLAS_SCHEDULED_EXECUTION_DISABLED"
							: !hasAuthorizationEvidence || !authorizationValid
								? "OUTREACH_AUTHORIZATION_REQUIRED"
								: !liveOutreachEnabled
									? "ATLAS_LIVE_OUTREACH_DISABLED"
									: "OUTREACH_MAILBOX_NOT_AUTHORIZED";
					await tx.followUpStep.updateMany({
						where: { id: step.id, leaseOwner: workerId },
						data: {
							status: "PENDING",
							attemptCount: { decrement: 1 },
							leaseOwner: null,
							leasedUntil: null,
							retryAt: new Date(Date.now() + 60_000),
							lastErrorCode: holdReason,
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
						authorizationId:
							autonomous && currentAuthorization
								? currentAuthorization.id
								: undefined,
						atlasAuthorizedAt:
							autonomous &&
							currentAuthorization &&
							(!draft.atlasAuthorizedAt || !storedAuthorizationValid)
								? new Date()
								: undefined,
						approvedAt: autonomous ? new Date() : undefined,
					},
				});
				await tx.followUpStep.updateMany({
					where: { id: step.id, leaseOwner: workerId },
					data: { status: "QUEUED", leaseOwner: null, leasedUntil: null },
				});
				if (cohortId) {
					await tx.followUpExecutionCohortMember.updateMany({
						where: {
							cohortId,
							followUpStepId: step.id,
							status: "PENDING",
						},
						data: { status: "QUEUED", blockReason: null },
					});
					const remaining = await tx.followUpExecutionCohortMember.count({
						where: { cohortId, status: "PENDING" },
					});
					if (remaining === 0)
						await tx.followUpExecutionCohort.updateMany({
							where: { id: cohortId, state: "ACTIVE" },
							data: { state: "COMPLETED" },
						});
				}
			},
		);
	}

	private async completeCohortIfSettled(
		tx: Prisma.TransactionClient,
		cohortId: string,
	) {
		const remaining = await tx.followUpExecutionCohortMember.count({
			where: { cohortId, status: "PENDING" },
		});
		if (remaining === 0)
			await tx.followUpExecutionCohort.updateMany({
				where: { id: cohortId, state: "ACTIVE" },
				data: { state: "COMPLETED" },
			});
	}

	private failStep(
		step: Claim,
		workerId: string,
		error: unknown,
		cohortId: string | null,
	) {
		const dead = step.attemptCount >= 5;
		const reason =
			error instanceof Error ? error.message.slice(0, 100) : "FOLLOW_UP_FAILED";
		return withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				const updated = await tx.followUpStep.updateMany({
					where: { id: step.id, leaseOwner: workerId },
					data: {
						status: dead ? "DEAD" : "PENDING",
						leaseOwner: null,
						leasedUntil: null,
						retryAt: dead
							? null
							: new Date(
									Date.now() +
										Math.min(3600000, 15000 * 2 ** step.attemptCount),
								),
						lastErrorCode: reason,
					},
				});
				if (cohortId && dead && updated.count) {
					await tx.followUpExecutionCohortMember.updateMany({
						where: {
							cohortId,
							followUpStepId: step.id,
							status: "PENDING",
						},
						data: { status: "BLOCKED", blockReason: reason },
					});
					await tx.domainAuditEvent.create({
						data: {
							action: "ATLAS_FOLLOW_UP_COHORT_MEMBER_BLOCKED",
							entityType: "OUTREACH",
							entityId: step.id,
							outcome: "BLOCKED",
							requestId: `atlas-follow-up-cohort:dead:${cohortId}:${step.id}`,
							metadata: { cohortId, reason },
						},
					});
					await this.completeCohortIfSettled(tx, cohortId);
				}
				return updated;
			},
		);
	}

	private async cancelForContactTx(
		tx: Prisma.TransactionClient,
		contactId: string,
		reason: string,
	) {
		const plans = await tx.followUpPlan.findMany({
			where: {
				contactId,
				channel: "EMAIL",
				status: { in: ["ACTIVE", "PAUSED"] },
			},
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

function followUpSubject(subject: string | null, position: number): string {
	const cleaned = (subject ?? "the earlier note")
		.replace(/^Re:\s*/i, "")
		.replace(/[—–]/g, "-")
		.trim();
	return position === 1 ? `Re: ${cleaned}` : `Re: ${cleaned}`;
}

function followUpBody(
	subject: string | null,
	position: number,
	language?: string | null,
): string {
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
