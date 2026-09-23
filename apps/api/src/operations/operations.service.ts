import {
	type Db,
	isProtectedPlayerContact,
	normalizePlayerName,
	PROTECTED_PLAYER_STATE,
	Prisma,
} from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	Optional,
} from "@nestjs/common";
import type { z } from "zod";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { bridge } from "../agent/bridge";
import { InjectDatabase } from "../database/database.constants";
import { localProviderDoubleEnabled } from "../providers/local-provider-double";
import type {
	approvalDecisionInput,
	approvalRequestInput,
	assignmentCreateInput,
	contactRouteCreateInput,
	contactRouteShareInput,
	draftCreateInput,
	draftUpdateInput,
	footballProfileInput,
	leadCreateInput,
	leadHandoffInput,
	leadTransitionInput,
	noteCreateInput,
	operationsListInput,
	organizationProfileInput,
	playerProtectionActiveInput,
	playerProtectionCreateInput,
	proofCreateInput,
	proposalCreateInput,
	representationCreateInput,
	representationTransitionInput,
	researchRequestCreateInput,
	taskCreateInput,
	taskTransitionInput,
	templateCreateInput,
} from "./operations.contracts";
import {
	coldOutreachReplyWhere,
	coldOutreachSentWhere,
} from "./outreach-metrics";

type Input<T extends z.ZodType> = z.infer<T>;

const OWNER_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

function startOfDay(): Date {
	const date = new Date();
	date.setHours(0, 0, 0, 0);
	return date;
}

function normalizeContactRoute(type: string, value: string): string {
	const trimmed = value.trim();
	if (type === "EMAIL") return trimmed.toLowerCase();
	if (["LINKEDIN", "INSTAGRAM", "SOCIAL"].includes(type)) {
		try {
			const url = new URL(
				/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
			);
			return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
		} catch {
			return trimmed.toLowerCase().replace(/\s+/g, "");
		}
	}
	return trimmed.toLowerCase().replace(/[\s()-]/g, "");
}

@Injectable()
export class OperationsService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		@Optional() private readonly agentTrigger?: AgentTriggerService,
	) {}

	private run<T>(
		userId: string,
		work: (tx: Prisma.TransactionClient) => Promise<T>,
	) {
		return withPrincipal(this.db, { userId, kind: "user" }, work);
	}

	private async roleOf(tx: Prisma.TransactionClient, userId: string) {
		const member = await tx.member.findUnique({
			where: { organizationId_userId: { organizationId: "workspace", userId } },
			select: { role: true },
		});
		return member?.role;
	}
	private async requireManager(
		tx: Prisma.TransactionClient,
		userId: string,
	): Promise<void> {
		const member = await tx.member.findUnique({
			where: {
				organizationId_userId: {
					organizationId: "workspace",
					userId,
				},
			},
			select: { role: true },
		});
		if (member?.role !== "admin" && member?.role !== "team") {
			throw new ForbiddenException(
				"This operation requires Team or Admin access.",
			);
		}
	}
	async overview(userId: string) {
		return this.run(userId, async (tx) => {
			const now = new Date();
			const [
				players,
				agents,
				agencies,
				clubs,
				representations,
				leads,
				tasks,
				overdueTasks,
				research,
				draftsInReview,
				proposalsInReview,
				duplicateCandidates,
			] = await Promise.all([
				tx.footballPlayer.count(),
				tx.footballAgent.count(),
				tx.agency.count(),
				tx.club.count(),
				tx.representation.count({
					where: { status: { in: ["PENDING", "ACTIVE", "DISPUTED"] } },
				}),
				tx.lead.count({
					where: { status: { notIn: ["ARCHIVED", "DISQUALIFIED"] } },
				}),
				tx.operationalTask.count({
					where: { status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } },
				}),
				tx.operationalTask.count({
					where: {
						dueAt: { lt: now },
						status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
					},
				}),
				tx.researchRequest.count({
					where: { status: { in: ["QUEUED", "RUNNING", "NEEDS_REVIEW"] } },
				}),
				tx.draft.count({ where: { status: "IN_REVIEW" } }),
				tx.proposal.count({ where: { status: "IN_REVIEW" } }),
				tx.duplicateCandidate.count({ where: { status: "OPEN" } }),
			]);
			return {
				players,
				agents,
				agencies,
				clubs,
				representations,
				leads,
				tasks,
				overdueTasks,
				research,
				draftsInReview,
				proposalsInReview,
				duplicateCandidates,
			};
		});
	}

	async outreachWorkspace(userId: string) {
		return this.run(userId, async (tx) => {
			const [
				role,
				capabilities,
				mailboxes,
				leads,
				research,
				drafts,
				approvals,
				deliveries,
				threads,
				audit,
				leadStageCounts,
				outreachSent,
				outreachReplies,
				meetings,
				wonLeads,
				quota,
				atlasReport,
			] = await Promise.all([
				this.roleOf(tx, userId),
				tx.providerCapability.findMany({
					select: { key: true, status: true, evidenceReference: true },
				}),
				tx.mailbox.findMany({
					orderBy: { address: "asc" },
					select: {
						id: true,
						ownerUserId: true,
						address: true,
						displayName: true,
						status: true,
						provider: true,
					},
				}),
				tx.lead.findMany({
					where: { status: { notIn: ["ARCHIVED", "DISQUALIFIED"] } },
					orderBy: { updatedAt: "desc" },
					take: 100,
					select: {
						id: true,
						name: true,
						status: true,
						stage: true,
						priority: true,
						attentionState: true,
						nextActionAt: true,
						nextActionTitle: true,
						handoffReason: true,
						handoffSummary: true,
						handoffRecommendedAction: true,
						handoffAt: true,
						lastContactedAt: true,
						lastRepliedAt: true,
						ownerUserId: true,
						company: { select: { name: true } },
						contact: {
							select: {
								id: true,
								firstName: true,
								lastName: true,
								contactRoutes: {
									where: { type: "EMAIL" },
									select: {
										id: true,
										ownerUserId: true,
										value: true,
										label: true,
									},
								},
							},
						},
					},
				}),
				tx.researchRequest.findMany({
					orderBy: { createdAt: "desc" },
					take: 100,
					select: {
						id: true,
						targetType: true,
						targetEntityId: true,
						prompt: true,
						status: true,
						failureCode: true,
						updatedAt: true,
						findings: {
							orderBy: { createdAt: "asc" },
							select: {
								id: true,
								summary: true,
								confidence: true,
								status: true,
								evidenceSource: {
									select: { kind: true, title: true, locator: true },
								},
							},
						},
					},
				}),
				tx.draft.findMany({
					orderBy: { updatedAt: "desc" },
					take: 100,
					select: {
						id: true,
						ownerUserId: true,
						mailboxId: true,
						recipientRouteId: true,
						subject: true,
						body: true,
						status: true,
						updatedAt: true,
						owner: { select: { name: true } },
						outreachApproval: {
							select: {
								id: true,
								status: true,
								requestedById: true,
								decidedById: true,
								decisionReason: true,
								requestedAt: true,
								decidedAt: true,
							},
						},
					},
				}),
				tx.outreachApproval.findMany({
					orderBy: { requestedAt: "desc" },
					take: 100,
					select: {
						id: true,
						status: true,
						requestedById: true,
						requestedBy: { select: { name: true } },
						draft: { select: { id: true, subject: true, body: true } },
					},
				}),
				tx.outboundDelivery.findMany({
					orderBy: { createdAt: "desc" },
					take: 100,
					select: {
						id: true,
						draftId: true,
						status: true,
						providerMessageId: true,
						lastErrorCode: true,
						sentAt: true,
					},
				}),
				tx.emailThread.findMany({
					orderBy: { lastMessageAt: "desc" },
					take: 100,
					select: {
						id: true,
						mailboxId: true,
						contactId: true,
						subject: true,
						messageCount: true,
						lastMessageAt: true,
						messages: {
							orderBy: { sentAt: "desc" },
							take: 1,
							select: {
								direction: true,
								snippet: true,
								body: true,
								sentAt: true,
							},
						},
					},
				}),
				tx.domainAuditEvent.findMany({
					where: {
						entityType: { in: ["RESEARCH_REQUEST", "DRAFT", "OUTREACH"] },
					},
					orderBy: { createdAt: "desc" },
					take: 100,
					select: {
						id: true,
						action: true,
						entityType: true,
						entityId: true,
						outcome: true,
						createdAt: true,
						actor: { select: { name: true } },
					},
				}),
				tx.lead.groupBy({ by: ["stage"], _count: { _all: true } }),
				tx.outboundDelivery.count({
					where: coldOutreachSentWhere(startOfDay()),
				}),
				tx.outboundDelivery.count({
					where: coldOutreachReplyWhere(startOfDay()),
				}),
				tx.activity.count({
					where: { type: "MEETING", createdAt: { gte: startOfDay() } },
				}),
				tx.lead.count({
					where: { stage: "WON", updatedAt: { gte: startOfDay() } },
				}),
				tx.outreachQuota.findFirst({
					orderBy: { day: "desc" },
					select: {
						day: true,
						coldEmailLimit: true,
						coldEmailReserved: true,
						coldEmailSent: true,
					},
				}),
				tx.atlasDailyReport.findFirst({ orderBy: { generatedAt: "desc" } }),
			]);
			const localProviderDouble = localProviderDoubleEnabled();
			return {
				viewer: { userId, role },
				readiness: {
					agent: bridge() ? "READY" : "UNCONFIGURED",
					mailbox: mailboxes.some(
						(mailbox) =>
							mailbox.ownerUserId === userId && mailbox.status === "VERIFIED",
					)
						? "READY"
						: "UNCONFIGURED",
					delivery:
						localProviderDouble ||
						capabilities.some(
							(capability) =>
								capability.key === "RESEND_OUTBOUND" &&
								capability.status === "VERIFIED",
						)
							? "READY"
							: "BLOCKED",
					localProviderDouble,
				},
				capabilities,
				mailboxes,
				leads,
				research,
				drafts,
				approvals,
				deliveries,
				threads,
				audit,
				dailyReport: {
					date: startOfDay(),
					leadStageCounts: Object.fromEntries(
						leadStageCounts.map((row) => [row.stage, row._count._all]),
					),
					outreachSent,
					outreachReplies,
					meetings,
					wonLeads,
					quota,
				},
				atlasDailyReport: atlasReport,
			};
		});
	}

	async prospectBacklog(userId: string) {
		return this.run(userId, async (tx) => {
			const batch = await tx.prospectSourceBatch.findFirst({
				orderBy: { importedAt: "desc" },
				select: {
					id: true,
					filename: true,
					sourceHash: true,
					importedAt: true,
					sourceSheetCount: true,
					recordCount: true,
					createdAt: true,
				},
			});
			if (!batch) return null;
			const [
				stateRows,
				canonicalProspects,
				sourceRecords,
				contactOnceRoutes,
				reusableRoutes,
				mailboxTypeRows,
				ambiguous,
				protectedPlayers,
				pilot,
			] = await Promise.all([
				tx.prospectBacklogItem.groupBy({
					by: ["state"],
					where: { batchId: batch.id },
					_count: { _all: true },
				}),
				tx.prospectBacklogItem.count({ where: { batchId: batch.id } }),
				tx.prospectSourceRecord.count({ where: { batchId: batch.id } }),
				tx.prospectBacklogRoute.count({
					where: { batchId: batch.id, routeUsage: "CONTACT_ONCE" },
				}),
				tx.prospectBacklogRoute.count({
					where: { batchId: batch.id, routeUsage: "REUSABLE" },
				}),
				tx.prospectBacklogRoute.groupBy({
					by: ["mailboxType"],
					where: { batchId: batch.id },
					_count: { _all: true },
				}),
				tx.prospectBacklogItem.count({
					where: { batchId: batch.id, matchStatus: "CRM_NAME_REVIEW" },
				}),
				tx.prospectPlayerProtection.findMany({
					where: { active: true, state: PROTECTED_PLAYER_STATE },
					orderBy: { displayName: "asc" },
					select: {
						id: true,
						displayName: true,
						normalizedName: true,
						reason: true,
						source: true,
						contactId: true,
						aliases: {
							select: { displayName: true, normalizedName: true },
						},
					},
				}),
				tx.prospectBacklogPilot.findFirst({
					where: { batchId: batch.id },
					orderBy: { preparedAt: "desc" },
					select: {
						name: true,
						status: true,
						preparedAt: true,
						items: {
							orderBy: { rank: "asc" },
							select: {
								rank: true,
								routeId: true,
								route: {
									select: {
										type: true,
										value: true,
										normalizedValue: true,
										mailboxType: true,
										routeUsage: true,
									},
								},
								item: {
									select: {
										id: true,
										displayName: true,
										entityType: true,
										state: true,
										agencyName: true,
									},
								},
								routeQuality: true,
								routeVisibility: true,
								mailboxType: true,
								mailboxTypeEvidence: true,
								routeUsage: true,
								routeConfidence: true,
								whyNow: true,
								researchConfidence: true,
								hookType: true,
								playerEntryPoint: true,
								credibilityAngle: true,
								ctaApproach: true,
								ctaWhy: true,
								followUpApproach: true,
								language: true,
								priority: true,
								proposedSubject: true,
								proposedBody: true,
								status: true,
							},
						},
					},
				}),
			]);
			const stateCounts: Record<string, number> = Object.fromEntries(
				[
					"NOT_REVIEWED",
					"REVIEWED",
					"NEEDS_ENRICHMENT",
					"ELIGIBLE",
					"READY",
					"CONTACTED",
					"REPLIED",
					"WARM",
					"WITH_IHSAN",
					"PARKED",
					"SUPPRESSED",
					"INVALID",
				].map((state) => [
					state,
					stateRows.find((row) => row.state === state)?._count._all ?? 0,
				]),
			);
			const remainingBacklog =
				(stateCounts.NOT_REVIEWED ?? 0) +
				(stateCounts.REVIEWED ?? 0) +
				(stateCounts.NEEDS_ENRICHMENT ?? 0) +
				(stateCounts.ELIGIBLE ?? 0) +
				(stateCounts.READY ?? 0);
			const protectedPilotItems =
				pilot?.items.filter(
					(item) =>
						item.playerEntryPoint &&
						protectedPlayers.some((player) => {
							const normalized = normalizePlayerName(
								item.playerEntryPoint ?? "",
							);
							return [
								player.normalizedName,
								...player.aliases.map((alias) => alias.normalizedName),
							].some(
								(name) => normalized === name || normalized.includes(name),
							);
						}),
				) ?? [];
			return {
				batch,
				counts: {
					canonicalProspects,
					sourceRecords,
					contactOnceRoutes,
					reusableRoutes,
					mailboxTypeCounts: Object.fromEntries(
						mailboxTypeRows.map((row) => [row.mailboxType, row._count._all]),
					),
					ambiguousIdentities: ambiguous,
					remainingBacklog,
				},
				stateCounts,
				protectedPlayers,
				protectedPilotItems: protectedPilotItems.map((item) => ({
					rank: item.rank,
					name: item.item.displayName,
					playerEntryPoint: item.playerEntryPoint,
					state: item.item.state,
					status: item.status,
				})),
				pilot,
			};
		});
	}

	async playerProtections(userId: string) {
		return this.run(userId, (tx) =>
			tx.prospectPlayerProtection.findMany({
				orderBy: [{ active: "desc" }, { displayName: "asc" }],
				select: {
					id: true,
					displayName: true,
					normalizedName: true,
					state: true,
					active: true,
					reason: true,
					source: true,
					contactId: true,
					aliases: {
						select: { displayName: true, normalizedName: true },
					},
					createdAt: true,
					updatedAt: true,
				},
			}),
		);
	}

	async upsertPlayerProtection(
		userId: string,
		input: Input<typeof playerProtectionCreateInput>,
	) {
		const normalizedName = normalizePlayerName(input.displayName);
		if (!normalizedName)
			throw new BadRequestException("Player name is required.");
		return this.run(userId, async (tx) => {
			if (input.contactId) {
				const player = await tx.footballPlayer.findUnique({
					where: { contactId: input.contactId },
					select: { contactId: true },
				});
				if (!player)
					throw new BadRequestException(
						"Player protection may only link to a football player contact.",
					);
			}
			const protection = await tx.prospectPlayerProtection.upsert({
				where: { normalizedName },
				create: {
					normalizedName,
					displayName: input.displayName,
					state: PROTECTED_PLAYER_STATE,
					active: true,
					reason: input.reason ?? null,
					source: input.source ?? "IHSAN_MANAGED",
					contactId: input.contactId ?? null,
				},
				update: {
					displayName: input.displayName,
					state: PROTECTED_PLAYER_STATE,
					active: true,
					reason: input.reason ?? null,
					source: input.source ?? "IHSAN_MANAGED",
					contactId: input.contactId ?? null,
				},
			});
			await tx.domainAuditEvent.create({
				data: {
					actorUserId: userId,
					action: "PLAYER_PROTECTION_UPSERTED",
					entityType: "PLAYER",
					entityId: protection.id,
					outcome: "SUCCESS",
					metadata: {
						displayName: protection.displayName,
						active: protection.active,
						state: protection.state,
					},
				},
			});
			return protection;
		});
	}

	async setPlayerProtectionActive(
		userId: string,
		input: Input<typeof playerProtectionActiveInput>,
	) {
		return this.run(userId, async (tx) => {
			const protection = await tx.prospectPlayerProtection.findUnique({
				where: { id: input.id },
				select: { id: true },
			});
			if (!protection)
				throw new NotFoundException("Player protection not found.");
			const updated = await tx.prospectPlayerProtection.update({
				where: { id: input.id },
				data: { active: input.active },
			});
			await tx.domainAuditEvent.create({
				data: {
					actorUserId: userId,
					action: input.active
						? "PLAYER_PROTECTION_ACTIVATED"
						: "PLAYER_PROTECTION_DEACTIVATED",
					entityType: "PLAYER",
					entityId: updated.id,
					outcome: "SUCCESS",
					metadata: {
						displayName: updated.displayName,
						active: updated.active,
						state: updated.state,
					},
				},
			});
			return updated;
		});
	}

	async selectors(userId: string, input: Input<typeof operationsListInput>) {
		return this.run(userId, async (tx) => {
			const term = input.q.trim();
			const contains = term
				? { contains: term, mode: "insensitive" as const }
				: undefined;
			const [
				contacts,
				companies,
				members,
				mailboxes,
				routes,
				drafts,
				approvals,
				leads,
			] = await Promise.all([
				tx.contact.findMany({
					where: {
						lifecycleState: "ACTIVE",
						...(contains
							? {
									OR: [
										{ firstName: contains },
										{ lastName: contains },
										{ email: contains },
									],
								}
							: {}),
					},
					take: input.take,
					orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
					select: {
						id: true,
						firstName: true,
						lastName: true,
						email: true,
						playerProfile: { select: { contactId: true } },
						footballAgentProfile: { select: { contactId: true } },
					},
				}),
				tx.company.findMany({
					where: {
						lifecycleState: "ACTIVE",
						...(contains ? { name: contains } : {}),
					},
					take: input.take,
					orderBy: { name: "asc" },
					select: {
						id: true,
						name: true,
						domain: true,
						agencyProfile: { select: { companyId: true } },
						clubProfile: { select: { companyId: true } },
					},
				}),
				tx.member.findMany({
					where: {
						organizationId: "workspace",
						user: { profile: { status: "ACTIVE" } },
					},
					take: input.take,
					orderBy: { user: { name: "asc" } },
					select: {
						userId: true,
						role: true,
						user: { select: { name: true, email: true } },
					},
				}),
				tx.mailbox.findMany({
					where: { status: "VERIFIED" },
					take: input.take,
					orderBy: { address: "asc" },
					select: { id: true, address: true, displayName: true },
				}),
				tx.contactRoute.findMany({
					where: {
						lifecycleState: "ACTIVE",
						OR: [{ ownerUserId: userId }, { visibility: "SHARED" }],
					},
					take: input.take,
					orderBy: { updatedAt: "desc" },
					select: {
						id: true,
						type: true,
						value: true,
						label: true,
						contact: { select: { id: true, firstName: true, lastName: true } },
						company: { select: { name: true } },
					},
				}),
				tx.draft.findMany({
					where: {
						ownerUserId: userId,
						status: { in: ["DRAFT", "IN_REVIEW", "APPROVED"] },
					},
					take: input.take,
					orderBy: { updatedAt: "desc" },
					select: {
						id: true,
						subject: true,
						status: true,
						recipientRouteId: true,
					},
				}),
				tx.outreachApproval.findMany({
					where: { status: "PENDING" },
					take: input.take,
					orderBy: { requestedAt: "desc" },
					select: {
						id: true,
						draft: { select: { subject: true } },
						requestedBy: { select: { name: true } },
					},
				}),
				tx.lead.findMany({
					where: { status: { notIn: ["ARCHIVED", "DISQUALIFIED"] } },
					take: input.take,
					orderBy: { updatedAt: "desc" },
					select: { id: true, name: true, status: true },
				}),
			]);
			return {
				contacts,
				companies,
				members,
				mailboxes,
				routes,
				drafts,
				approvals,
				leads,
			};
		});
	}

	async leadById(userId: string, id: string) {
		return this.run(userId, async (tx) => {
			const lead = await tx.lead.findUnique({
				where: { id },
				select: {
					id: true,
					name: true,
					status: true,
					stage: true,
					stageChangedAt: true,
					priority: true,
					originChannel: true,
					source: true,
					sourceKey: true,
					nextActionAt: true,
					nextActionTitle: true,
					outcome: true,
					outcomeNote: true,
					blocker: true,
					attentionState: true,
					handoffReason: true,
					handoffSummary: true,
					handoffRecommendedAction: true,
					handoffSuggestedResponses: true,
					handoffAt: true,
					handoffDeadlineAt: true,
					ihsanTakenOverAt: true,
					lastContactedAt: true,
					lastRepliedAt: true,
					parkedUntil: true,
					lastLanguage: true,
					needsReview: true,
					createdAt: true,
					updatedAt: true,
					owner: { select: OWNER_SELECT },
					createdBy: { select: OWNER_SELECT },
					company: {
						select: {
							id: true,
							name: true,
							domain: true,
							linkedinUrl: true,
						},
					},
					contact: {
						select: {
							id: true,
							firstName: true,
							lastName: true,
							email: true,
							title: true,
							linkedinUrl: true,
							company: { select: { id: true, name: true } },
							contactRoutes: {
								where: { lifecycleState: "ACTIVE" },
								orderBy: { updatedAt: "desc" },
								select: {
									id: true,
									type: true,
									value: true,
									label: true,
									visibility: true,
									verifiedAt: true,
								},
							},
						},
					},
					deal: {
						select: {
							id: true,
							name: true,
							stage: true,
							amount: true,
							currency: true,
						},
					},
					activities: {
						orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
						select: {
							id: true,
							type: true,
							subject: true,
							body: true,
							occurredAt: true,
							createdAt: true,
							meta: true,
							lifecycleState: true,
							createdBy: { select: OWNER_SELECT },
						},
					},
					emailThreads: {
						orderBy: { firstMessageAt: "asc" },
						select: {
							id: true,
							subject: true,
							firstMessageAt: true,
							lastMessageAt: true,
							messageCount: true,
							messages: {
								orderBy: { sentAt: "asc" },
								select: {
									id: true,
									direction: true,
									fromEmail: true,
									fromName: true,
									recipients: true,
									subject: true,
									snippet: true,
									body: true,
									sentAt: true,
								},
							},
						},
					},
					stageHistory: {
						orderBy: { createdAt: "asc" },
						select: {
							id: true,
							fromStage: true,
							toStage: true,
							reason: true,
							createdAt: true,
							actor: { select: OWNER_SELECT },
						},
					},
					tasks: {
						orderBy: { createdAt: "asc" },
						select: {
							id: true,
							title: true,
							status: true,
							dueAt: true,
							completedAt: true,
						},
					},
					notes: {
						orderBy: { createdAt: "asc" },
						select: {
							id: true,
							body: true,
							createdAt: true,
							author: { select: OWNER_SELECT },
						},
					},
					meetingRequests: {
						orderBy: { createdAt: "asc" },
						select: {
							id: true,
							status: true,
							title: true,
							startsAt: true,
							endsAt: true,
							calendarId: true,
							createdAt: true,
						},
					},
				},
			});

			if (!lead) throw new NotFoundException(`No lead with id ${id}.`);

			const iso = (value: Date | null) => value?.toISOString() ?? null;
			return {
				...lead,
				stageChangedAt: lead.stageChangedAt.toISOString(),
				nextActionAt: iso(lead.nextActionAt),
				handoffAt: iso(lead.handoffAt),
				handoffDeadlineAt: iso(lead.handoffDeadlineAt),
				ihsanTakenOverAt: iso(lead.ihsanTakenOverAt),
				lastContactedAt: iso(lead.lastContactedAt),
				lastRepliedAt: iso(lead.lastRepliedAt),
				parkedUntil: iso(lead.parkedUntil),
				createdAt: lead.createdAt.toISOString(),
				updatedAt: lead.updatedAt.toISOString(),
				contact: lead.contact
					? {
							...lead.contact,
							contactRoutes: lead.contact.contactRoutes.map((route) => ({
								...route,
								verifiedAt: iso(route.verifiedAt),
							})),
						}
					: null,
				activities: lead.activities.map((activity) => ({
					...activity,
					occurredAt: iso(activity.occurredAt),
					createdAt: activity.createdAt.toISOString(),
				})),
				emailThreads: lead.emailThreads.map((thread) => ({
					...thread,
					firstMessageAt: thread.firstMessageAt.toISOString(),
					lastMessageAt: thread.lastMessageAt.toISOString(),
					messages: thread.messages.map((message) => ({
						...message,
						sentAt: message.sentAt.toISOString(),
					})),
				})),
				stageHistory: lead.stageHistory.map((entry) => ({
					...entry,
					createdAt: entry.createdAt.toISOString(),
				})),
				tasks: lead.tasks.map((task) => ({
					...task,
					dueAt: iso(task.dueAt),
					completedAt: iso(task.completedAt),
				})),
				notes: lead.notes.map((note) => ({
					...note,
					createdAt: note.createdAt.toISOString(),
				})),
				meetingRequests: lead.meetingRequests.map((request) => ({
					...request,
					startsAt: request.startsAt.toISOString(),
					endsAt: request.endsAt.toISOString(),
					createdAt: request.createdAt.toISOString(),
				})),
			};
		});
	}

	async directory(userId: string, input: Input<typeof operationsListInput>) {
		return this.run(userId, async (tx) => {
			const contains = input.q
				? { contains: input.q, mode: "insensitive" as const }
				: undefined;
			const [players, agents, agencies, clubs, representations, routes] =
				await Promise.all([
					tx.footballPlayer.findMany({
						where: contains
							? {
									contact: {
										OR: [{ firstName: contains }, { lastName: contains }],
									},
								}
							: undefined,
						skip: input.skip,
						take: input.take,
						orderBy: { updatedAt: "desc" },
						select: {
							contactId: true,
							position: true,
							contact: { select: { firstName: true, lastName: true } },
						},
					}),
					tx.footballAgent.findMany({
						where: contains
							? {
									contact: {
										OR: [{ firstName: contains }, { lastName: contains }],
									},
								}
							: undefined,
						skip: input.skip,
						take: input.take,
						orderBy: { updatedAt: "desc" },
						select: {
							contactId: true,
							contact: { select: { firstName: true, lastName: true } },
							agency: { select: { company: { select: { name: true } } } },
						},
					}),
					tx.agency.findMany({
						where: contains ? { company: { name: contains } } : undefined,
						skip: input.skip,
						take: input.take,
						orderBy: { updatedAt: "desc" },
						select: {
							companyId: true,
							company: { select: { name: true } },
							_count: { select: { agents: true } },
						},
					}),
					tx.club.findMany({
						where: contains ? { company: { name: contains } } : undefined,
						skip: input.skip,
						take: input.take,
						orderBy: { updatedAt: "desc" },
						select: {
							companyId: true,
							company: { select: { name: true } },
							_count: { select: { players: true } },
						},
					}),
					tx.representation.findMany({
						skip: input.skip,
						take: input.take,
						orderBy: { updatedAt: "desc" },
						select: {
							id: true,
							status: true,
							player: { select: { firstName: true } },
							agent: { select: { firstName: true } },
							agency: { select: { name: true } },
						},
					}),
					tx.contactRoute.findMany({
						where: { lifecycleState: "ACTIVE" },
						skip: input.skip,
						take: input.take,
						orderBy: { updatedAt: "desc" },
						select: {
							id: true,
							type: true,
							label: true,
							visibility: true,
							contact: { select: { firstName: true } },
							company: { select: { name: true } },
						},
					}),
				]);
			return { players, agents, agencies, clubs, representations, routes };
		});
	}

	async workbench(userId: string, input: Input<typeof operationsListInput>) {
		return this.run(userId, async (tx) => {
			const [
				stages,
				leads,
				tasks,
				notes,
				assignments,
				research,
				evidence,
				proofs,
				templates,
				drafts,
				proposals,
				approvals,
				duplicates,
			] = await Promise.all([
				tx.pipelineStage.findMany({
					where: { active: true },
					orderBy: { position: "asc" },
					include: { _count: { select: { deals: true } } },
				}),
				tx.lead.findMany({
					skip: input.skip,
					take: input.take,
					orderBy: { updatedAt: "desc" },
					select: {
						id: true,
						name: true,
						status: true,
						owner: { select: { name: true } },
					},
				}),
				tx.operationalTask.findMany({
					skip: input.skip,
					take: input.take,
					orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
					select: {
						id: true,
						title: true,
						status: true,
						priority: true,
						dueAt: true,
						assignee: { select: { name: true } },
					},
				}),
				tx.note.findMany({
					skip: input.skip,
					take: input.take,
					orderBy: { createdAt: "desc" },
					select: {
						id: true,
						body: true,
						createdAt: true,
						author: { select: { name: true } },
					},
				}),
				tx.assignment.findMany({
					where: { revokedAt: null },
					skip: input.skip,
					take: input.take,
					orderBy: { assignedAt: "desc" },
					select: {
						id: true,
						entityType: true,
						entityId: true,
						assignee: { select: { name: true } },
						assignedBy: { select: { name: true } },
					},
				}),
				tx.researchRequest.findMany({
					skip: input.skip,
					take: input.take,
					orderBy: { createdAt: "desc" },
					select: {
						id: true,
						prompt: true,
						status: true,
						_count: { select: { findings: true } },
					},
				}),
				tx.evidenceSource.findMany({
					skip: input.skip,
					take: input.take,
					orderBy: { createdAt: "desc" },
					select: {
						id: true,
						kind: true,
						title: true,
						locator: true,
						_count: { select: { proofItems: true, findings: true } },
					},
				}),
				tx.proofItem.findMany({
					skip: input.skip,
					take: input.take,
					orderBy: { updatedAt: "desc" },
					select: { id: true, label: true, proofType: true, reference: true },
				}),
				tx.template.findMany({
					skip: input.skip,
					take: input.take,
					orderBy: { updatedAt: "desc" },
					select: { id: true, name: true, kind: true, active: true },
				}),
				tx.draft.findMany({
					skip: input.skip,
					take: input.take,
					orderBy: { updatedAt: "desc" },
					select: {
						id: true,
						subject: true,
						status: true,
						outreachApproval: { select: { id: true, status: true } },
					},
				}),
				tx.proposal.findMany({
					skip: input.skip,
					take: input.take,
					orderBy: { updatedAt: "desc" },
					select: {
						id: true,
						title: true,
						status: true,
						_count: { select: { items: true } },
					},
				}),
				tx.outreachApproval.findMany({
					skip: input.skip,
					take: input.take,
					orderBy: { requestedAt: "desc" },
					select: {
						id: true,
						draftId: true,
						status: true,
						requestedBy: { select: { name: true } },
						decidedBy: { select: { name: true } },
					},
				}),
				tx.duplicateCandidate.findMany({
					where: { status: "OPEN" },
					skip: input.skip,
					take: input.take,
					orderBy: { score: "desc" },
					select: {
						id: true,
						entityType: true,
						leftEntityId: true,
						rightEntityId: true,
						score: true,
					},
				}),
			]);
			return {
				stages,
				leads,
				tasks,
				notes,
				assignments,
				research,
				evidence,
				proofs,
				templates,
				drafts,
				proposals,
				approvals,
				duplicates,
			};
		});
	}

	async saveFootballProfile(
		userId: string,
		input: Input<typeof footballProfileInput>,
	) {
		return this.run(userId, async (tx) => {
			if (input.kind === "PLAYER") {
				return tx.footballPlayer.upsert({
					where: { contactId: input.contactId },
					create: {
						contactId: input.contactId,
						nationality: input.nationality,
						position: input.position,
						preferredFoot: input.preferredFoot,
					},
					update: {
						nationality: input.nationality,
						position: input.position,
						preferredFoot: input.preferredFoot,
					},
				});
			}
			return tx.footballAgent.upsert({
				where: { contactId: input.contactId },
				create: {
					contactId: input.contactId,
					agencyId: input.agencyId,
					licenseNumber: input.licenseNumber,
					licenseCountry: input.licenseCountry,
				},
				update: {
					agencyId: input.agencyId,
					licenseNumber: input.licenseNumber,
					licenseCountry: input.licenseCountry,
				},
			});
		});
	}

	async saveOrganizationProfile(
		userId: string,
		input: Input<typeof organizationProfileInput>,
	) {
		return this.run(userId, async (tx) => {
			if (input.kind === "AGENCY") {
				return tx.agency.upsert({
					where: { companyId: input.companyId },
					create: {
						companyId: input.companyId,
						registrationId: input.registrationId,
						jurisdiction: input.jurisdiction,
					},
					update: {
						registrationId: input.registrationId,
						jurisdiction: input.jurisdiction,
					},
				});
			}
			return tx.club.upsert({
				where: { companyId: input.companyId },
				create: {
					companyId: input.companyId,
					association: input.association,
					league: input.league,
					countryCode: input.countryCode,
				},
				update: {
					association: input.association,
					league: input.league,
					countryCode: input.countryCode,
				},
			});
		});
	}

	async createRepresentation(
		userId: string,
		input: Input<typeof representationCreateInput>,
	) {
		return this.run(userId, async (tx) => {
			const representation = await tx.representation.create({
				data: {
					playerContactId: input.playerContactId,
					agentContactId: input.agentContactId,
					agencyCompanyId: input.agencyCompanyId,
					status: input.status,
					startedAt: input.startedAt ? new Date(input.startedAt) : null,
					createdByUserId: userId,
				},
			});
			await tx.representationHistory.create({
				data: {
					representationId: representation.id,
					toStatus: representation.status,
					actorUserId: userId,
					reason: input.reason,
				},
			});
			return representation;
		});
	}

	async transitionRepresentation(
		userId: string,
		input: Input<typeof representationTransitionInput>,
	) {
		return this.run(userId, async (tx) => {
			const current = await tx.representation.findUnique({
				where: { id: input.id },
			});
			if (!current) throw new NotFoundException("Representation not found.");
			const updated = await tx.representation.update({
				where: { id: input.id },
				data: {
					status: input.status,
					endedAt: input.status === "FORMER" ? new Date() : current.endedAt,
				},
			});
			await tx.representationHistory.create({
				data: {
					representationId: input.id,
					fromStatus: current.status,
					toStatus: input.status,
					actorUserId: userId,
					reason: input.reason,
				},
			});
			return updated;
		});
	}

	async createRoute(
		userId: string,
		input: Input<typeof contactRouteCreateInput>,
	) {
		if (Boolean(input.contactId) === Boolean(input.companyId))
			throw new BadRequestException("Choose exactly one contact or company.");
		const normalizedValue = normalizeContactRoute(input.type, input.value);
		return this.run(userId, async (tx) => {
			const existing = await tx.contactRoute.findFirst({
				where: { type: input.type, normalizedValue },
				select: { id: true, contactId: true, companyId: true },
			});
			if (existing) {
				if (
					existing.contactId === (input.contactId ?? null) &&
					existing.companyId === (input.companyId ?? null)
				)
					return existing;
				throw new BadRequestException(
					"This contact route is already attached to another CRM profile.",
				);
			}
			return tx.contactRoute.create({
				data: { ...input, ownerUserId: userId, normalizedValue },
			});
		});
	}

	async shareRoute(
		userId: string,
		input: Input<typeof contactRouteShareInput>,
	) {
		if (Boolean(input.granteeContactId) === Boolean(input.granteeCompanyId))
			throw new BadRequestException("Choose exactly one grantee.");
		return this.run(userId, (tx) =>
			tx.sharedRoutePolicy.create({
				data: { ...input, approvedByUserId: userId },
			}),
		);
	}

	async createLead(userId: string, input: Input<typeof leadCreateInput>) {
		return this.run(userId, async (tx) => {
			if (input.contactId) {
				const contact = await tx.contact.findUnique({
					where: { id: input.contactId },
					select: { id: true, firstName: true, lastName: true },
				});
				if (
					contact &&
					(await isProtectedPlayerContact(
						tx,
						contact.id,
						`${contact.firstName} ${contact.lastName ?? ""}`,
					))
				)
					throw new BadRequestException(
						"Protected players cannot be created as new outreach leads.",
					);
			}
			const ownerUserId =
				(await this.roleOf(tx, userId)) === "contributor"
					? userId
					: input.ownerUserId;
			const lead = await tx.lead.create({
				data: {
					...input,
					ownerUserId,
					nextActionAt: input.nextActionAt
						? new Date(input.nextActionAt)
						: new Date(),
					nextActionTitle: input.nextActionTitle ?? "Define the next action",
					createdByUserId: userId,
				},
			});
			await tx.leadStageHistory.create({
				data: {
					leadId: lead.id,
					toStage: "NEW",
					reason: "Lead created",
					actorUserId: userId,
				},
			});
			return lead;
		});
	}

	async transitionLead(
		userId: string,
		input: Input<typeof leadTransitionInput>,
	) {
		return this.run(userId, async (tx) => {
			const lead = await tx.lead.findUnique({
				where: { id: input.id },
				select: {
					id: true,
					stage: true,
					ownerUserId: true,
					attentionState: true,
				},
			});
			if (!lead) throw new NotFoundException("Lead not found.");
			const role = await this.roleOf(tx, userId);
			if (role === "contributor" && lead.ownerUserId !== userId)
				throw new ForbiddenException(
					"Contributors may transition only owned leads.",
				);
			const terminal = input.stage === "WON" || input.stage === "LOST";
			const nextActionAt = input.nextActionAt
				? new Date(input.nextActionAt)
				: null;
			const nextActionTitle = input.nextActionTitle ?? null;
			if (
				!terminal &&
				lead.attentionState !== "SUPPRESSED" &&
				(!nextActionAt || !nextActionTitle)
			)
				throw new BadRequestException(
					"Every active lead requires a next action title and time.",
				);
			const updated = await tx.lead.update({
				where: { id: input.id },
				data: {
					stage: input.stage,
					stageChangedAt: new Date(),
					nextActionAt,
					nextActionTitle,
					outcome:
						input.outcome ??
						(terminal ? (input.stage === "WON" ? "WON" : "LOST") : null),
					outcomeNote: input.outcomeNote ?? undefined,
					blocker: input.blocker ?? undefined,
				},
			});
			if (lead.stage !== input.stage)
				await tx.leadStageHistory.create({
					data: {
						leadId: lead.id,
						fromStage: lead.stage,
						toStage: input.stage,
						reason: input.outcomeNote ?? "Lead stage changed",
						actorUserId: userId,
					},
				});
			return updated;
		});
	}

	async handoffLead(userId: string, input: Input<typeof leadHandoffInput>) {
		return this.run(userId, async (tx) => {
			const lead = await tx.lead.findUnique({
				where: { id: input.id },
				select: { id: true, ownerUserId: true },
			});
			if (!lead) throw new NotFoundException("Lead not found.");
			const role = await this.roleOf(tx, userId);
			if (role === "contributor" && lead.ownerUserId !== userId)
				throw new ForbiddenException(
					"Contributors may hand off only owned leads.",
				);
			return tx.lead.update({
				where: { id: input.id },
				data: {
					attentionState: input.attentionState,
					handoffReason: input.reason,
					handoffSummary: input.summary ?? null,
					handoffRecommendedAction: input.recommendedAction ?? null,
					handoffSuggestedResponses: input.suggestedResponses ?? undefined,
					handoffAt: new Date(),
					handoffDeadlineAt: input.deadlineAt
						? new Date(input.deadlineAt)
						: null,
					parkedUntil: input.parkedUntil ? new Date(input.parkedUntil) : null,
					ihsanTakenOverAt:
						input.attentionState === "WITH_IHSAN" ? new Date() : null,
					nextActionAt:
						input.attentionState === "SUPPRESSED" ? null : undefined,
					nextActionTitle:
						input.attentionState === "SUPPRESSED" ? null : undefined,
				},
			});
		});
	}
	async createTask(userId: string, input: Input<typeof taskCreateInput>) {
		return this.run(userId, async (tx) => {
			const assigneeUserId =
				(await this.roleOf(tx, userId)) === "contributor"
					? userId
					: input.assigneeUserId;
			return tx.operationalTask.create({
				data: {
					...input,
					assigneeUserId,
					dueAt: input.dueAt ? new Date(input.dueAt) : null,
					reminderAt: input.reminderAt ? new Date(input.reminderAt) : null,
					createdByUserId: userId,
				},
			});
		});
	}
	async transitionTask(
		userId: string,
		input: Input<typeof taskTransitionInput>,
	) {
		return this.run(userId, (tx) =>
			tx.operationalTask.update({
				where: { id: input.id },
				data: {
					status: input.status,
					completedAt: input.status === "DONE" ? new Date() : null,
				},
			}),
		);
	}

	async createNote(userId: string, input: Input<typeof noteCreateInput>) {
		return this.run(userId, (tx) =>
			tx.note.create({ data: { ...input, authorUserId: userId } }),
		);
	}

	async assign(userId: string, input: Input<typeof assignmentCreateInput>) {
		return this.run(userId, async (tx) => {
			await this.requireManager(tx, userId);
			await tx.assignment.updateMany({
				where: {
					entityType: input.entityType,
					entityId: input.entityId,
					revokedAt: null,
				},
				data: { revokedAt: new Date() },
			});
			return tx.assignment.create({
				data: { ...input, assignedByUserId: userId },
			});
		});
	}

	async requestResearch(
		userId: string,
		input: Input<typeof researchRequestCreateInput>,
	) {
		const request = await this.run(userId, (tx) =>
			tx.researchRequest.create({ data: { ...input, ownerUserId: userId } }),
		);
		this.agentTrigger?.researchQueued();
		return request;
	}

	async createTemplate(
		userId: string,
		input: Input<typeof templateCreateInput>,
	) {
		const { shared, ...data } = input;
		return this.run(userId, async (tx) => {
			if (shared) await this.requireManager(tx, userId);
			return tx.template.create({
				data: { ...data, ownerUserId: shared ? null : userId },
			});
		});
	}

	async createDraft(userId: string, input: Input<typeof draftCreateInput>) {
		return this.run(userId, async (tx) => {
			if (input.recipientRouteId) {
				const route = await tx.contactRoute.findUnique({
					where: { id: input.recipientRouteId },
					select: {
						ownerUserId: true,
						type: true,
						contact: { select: { lifecycleState: true } },
					},
				});
				const consent = await tx.contactRouteConsent.findUnique({
					where: { routeId: input.recipientRouteId },
				});
				if (
					!route ||
					route.ownerUserId !== userId ||
					route.type !== "EMAIL" ||
					route.contact?.lifecycleState !== "ACTIVE" ||
					consent?.status === "DO_NOT_CONTACT"
				) {
					throw new ForbiddenException("This route cannot receive outreach.");
				}
			}
			return tx.draft.create({ data: { ...input, ownerUserId: userId } });
		});
	}

	async updateDraft(userId: string, input: Input<typeof draftUpdateInput>) {
		return this.run(userId, async (tx) => {
			const [draft, mailbox, route, consent] = await Promise.all([
				tx.draft.findUnique({
					where: { id: input.id },
					select: { ownerUserId: true, status: true },
				}),
				tx.mailbox.findUnique({
					where: { id: input.mailboxId },
					select: { ownerUserId: true, status: true },
				}),
				tx.contactRoute.findUnique({
					where: { id: input.recipientRouteId },
					select: {
						ownerUserId: true,
						type: true,
						contact: { select: { lifecycleState: true } },
					},
				}),
				tx.contactRouteConsent.findUnique({
					where: { routeId: input.recipientRouteId },
					select: { status: true },
				}),
			]);
			if (!draft || draft.ownerUserId !== userId || draft.status !== "DRAFT") {
				throw new ForbiddenException(
					"Only your editable drafts can be changed.",
				);
			}
			if (
				!mailbox ||
				mailbox.ownerUserId !== userId ||
				mailbox.status !== "VERIFIED"
			) {
				throw new ForbiddenException("Sending requires your verified mailbox.");
			}
			if (
				!route ||
				route.ownerUserId !== userId ||
				route.type !== "EMAIL" ||
				route.contact?.lifecycleState !== "ACTIVE" ||
				consent?.status === "DO_NOT_CONTACT"
			) {
				throw new ForbiddenException("This route cannot receive outreach.");
			}
			const updated = await tx.draft.update({
				where: { id: input.id },
				data: {
					mailboxId: input.mailboxId,
					recipientRouteId: input.recipientRouteId,
					subject: input.subject,
					body: input.body,
				},
			});
			await tx.domainAuditEvent.create({
				data: {
					actorUserId: userId,
					action: "OUTREACH_DRAFT_EDITED",
					entityType: "DRAFT",
					entityId: input.id,
					outcome: "DRAFT",
					requestId: `draft-edit:${input.id}:${updated.updatedAt.toISOString()}`,
				},
			});
			return updated;
		});
	}

	async requestApproval(
		userId: string,
		input: Input<typeof approvalRequestInput>,
	) {
		return this.run(userId, async (tx) => {
			const draft = await tx.draft.findUnique({
				where: { id: input.draftId },
				select: {
					ownerUserId: true,
					status: true,
					recipientRouteId: true,
					recipientRoute: {
						select: { contact: { select: { lifecycleState: true } } },
					},
				},
			});
			const consent = draft?.recipientRouteId
				? await tx.contactRouteConsent.findUnique({
						where: { routeId: draft.recipientRouteId },
					})
				: null;
			if (
				!draft ||
				draft.ownerUserId !== userId ||
				draft.status !== "DRAFT" ||
				draft.recipientRoute?.contact?.lifecycleState !== "ACTIVE" ||
				consent?.status === "DO_NOT_CONTACT"
			)
				throw new ForbiddenException("This draft cannot enter review.");
			await tx.draft.update({
				where: { id: input.draftId },
				data: { status: "IN_REVIEW" },
			});
			const approval = await tx.outreachApproval.create({
				data: { ...input, requestedById: userId },
			});
			await tx.domainAuditEvent.create({
				data: {
					actorUserId: userId,
					action: "OUTREACH_APPROVAL_REQUESTED",
					entityType: "DRAFT",
					entityId: input.draftId,
					outcome: "IN_REVIEW",
					requestId: input.idempotencyKey,
				},
			});
			return approval;
		});
	}

	async decideApproval(
		userId: string,
		input: Input<typeof approvalDecisionInput>,
	) {
		return this.run(userId, async (tx) => {
			await this.requireManager(tx, userId);
			const approval = await tx.outreachApproval.findUniqueOrThrow({
				where: { id: input.id },
				select: {
					draftId: true,
					requestedById: true,
					status: true,
					draft: { select: { recipientRouteId: true } },
				},
			});
			if (approval.requestedById === userId || approval.status !== "PENDING")
				throw new ForbiddenException(
					"The requester cannot decide this approval.",
				);
			const decidedAt = new Date();
			await tx.$executeRaw(
				Prisma.sql`SELECT ibl_decide_outreach_approval(${input.id}, ${input.status}, ${input.reason}, ${decidedAt})`,
			);
			return tx.outreachApproval.findUniqueOrThrow({ where: { id: input.id } });
		});
	}

	async createProposal(
		userId: string,
		input: Input<typeof proposalCreateInput>,
	) {
		if (!input.leadId && !input.dealId)
			throw new BadRequestException("Choose a lead or deal for the proposal.");
		const { items, ...proposal } = input;
		return this.run(userId, (tx) =>
			tx.proposal.create({
				data: {
					...proposal,
					content: proposal.content as Prisma.InputJsonValue,
					ownerUserId: userId,
					items: {
						create: items.map((item, position) => ({ ...item, position })),
					},
				},
				include: { items: true },
			}),
		);
	}

	async createProof(userId: string, input: Input<typeof proofCreateInput>) {
		return this.run(userId, (tx) => tx.proofItem.create({ data: input }));
	}
}
