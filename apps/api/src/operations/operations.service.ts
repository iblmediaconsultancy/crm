import type { Db, Prisma } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import type { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import type {
	approvalDecisionInput,
	approvalRequestInput,
	assignmentCreateInput,
	contactRouteCreateInput,
	contactRouteShareInput,
	draftCreateInput,
	footballProfileInput,
	leadCreateInput,
	noteCreateInput,
	operationsListInput,
	organizationProfileInput,
	proofCreateInput,
	proposalCreateInput,
	representationCreateInput,
	representationTransitionInput,
	researchRequestCreateInput,
	taskCreateInput,
	taskTransitionInput,
	templateCreateInput,
} from "./operations.contracts";

type Input<T extends z.ZodType> = z.infer<T>;

@Injectable()
export class OperationsService {
	constructor(@InjectDatabase() private readonly db: Db) {}

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
			throw new ForbiddenException("This operation requires Team or Admin access.");
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

	async selectors(userId: string, input: Input<typeof operationsListInput>) {
		return this.run(userId, async (tx) => {
			const term = input.q.trim();
			const contains = term ? { contains: term, mode: "insensitive" as const } : undefined;
			const [contacts, companies, members, mailboxes, routes, drafts, approvals, leads] = await Promise.all([
				tx.contact.findMany({ where: { lifecycleState: "ACTIVE", ...(contains ? { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }] } : {}) }, take: input.take, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], select: { id: true, firstName: true, lastName: true, email: true, playerProfile: { select: { contactId: true } }, footballAgentProfile: { select: { contactId: true } } } }),
				tx.company.findMany({ where: { lifecycleState: "ACTIVE", ...(contains ? { name: contains } : {}) }, take: input.take, orderBy: { name: "asc" }, select: { id: true, name: true, domain: true, agencyProfile: { select: { companyId: true } }, clubProfile: { select: { companyId: true } } } }),
				tx.member.findMany({ where: { organizationId: "workspace", user: { profile: { status: "ACTIVE" } } }, take: input.take, orderBy: { user: { name: "asc" } }, select: { userId: true, role: true, user: { select: { name: true, email: true } } } }),
				tx.mailbox.findMany({ where: { status: "VERIFIED" }, take: input.take, orderBy: { address: "asc" }, select: { id: true, address: true, displayName: true } }),
				tx.contactRoute.findMany({ where: { OR: [{ ownerUserId: userId }, { visibility: "SHARED" }] }, take: input.take, orderBy: { updatedAt: "desc" }, select: { id: true, type: true, value: true, label: true, contact: { select: { id: true, firstName: true, lastName: true } }, company: { select: { name: true } } } }),
				tx.draft.findMany({ where: { ownerUserId: userId, status: { in: ["DRAFT", "IN_REVIEW", "APPROVED"] } }, take: input.take, orderBy: { updatedAt: "desc" }, select: { id: true, subject: true, status: true, recipientRouteId: true } }),
				tx.outreachApproval.findMany({ where: { status: "PENDING" }, take: input.take, orderBy: { requestedAt: "desc" }, select: { id: true, draft: { select: { subject: true } }, requestedBy: { select: { name: true } } } }),
				tx.lead.findMany({ where: { status: { notIn: ["ARCHIVED", "DISQUALIFIED"] } }, take: input.take, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, status: true } }),
			]);
			return { contacts, companies, members, mailboxes, routes, drafts, approvals, leads };
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
		const normalizedValue =
			input.type === "EMAIL"
				? input.value.toLowerCase()
				: input.value.replace(/[\s()-]/g, "").toLowerCase();
		return this.run(userId, (tx) =>
			tx.contactRoute.create({
				data: { ...input, ownerUserId: userId, normalizedValue },
			}),
		);
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
			const ownerUserId =
				(await this.roleOf(tx, userId)) === "contributor"
					? userId
					: input.ownerUserId;
			return tx.lead.create({
				data: {
					...input,
					ownerUserId,
					nextActionAt: input.nextActionAt
						? new Date(input.nextActionAt)
						: null,
					createdByUserId: userId,
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
		return this.run(userId, (tx) =>
			tx.researchRequest.create({ data: { ...input, ownerUserId: userId } }),
		);
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
					select: { ownerUserId: true, type: true, contact: { select: { lifecycleState: true } } },
				});
				const consent = await tx.contactRouteConsent.findUnique({ where: { routeId: input.recipientRouteId } });
				if (!route || route.ownerUserId !== userId || route.type !== "EMAIL" || route.contact?.lifecycleState !== "ACTIVE" || consent?.status === "DO_NOT_CONTACT") {
					throw new ForbiddenException("This route cannot receive outreach.");
				}
			}
			return tx.draft.create({ data: { ...input, ownerUserId: userId } });
		});
	}

	async requestApproval(userId: string, input: Input<typeof approvalRequestInput>) {
		return this.run(userId, async (tx) => {
			const draft = await tx.draft.findUnique({ where: { id: input.draftId }, select: { ownerUserId: true, status: true, recipientRouteId: true, recipientRoute: { select: { contact: { select: { lifecycleState: true } } } } } });
			const consent = draft?.recipientRouteId ? await tx.contactRouteConsent.findUnique({ where: { routeId: draft.recipientRouteId } }) : null;
			if (!draft || draft.ownerUserId !== userId || draft.status !== "DRAFT" || draft.recipientRoute?.contact?.lifecycleState !== "ACTIVE" || consent?.status === "DO_NOT_CONTACT") throw new ForbiddenException("This draft cannot enter review.");
			await tx.draft.update({ where: { id: input.draftId }, data: { status: "IN_REVIEW" } });
			return tx.outreachApproval.create({ data: { ...input, requestedById: userId } });
		});
	}

	async decideApproval(userId: string, input: Input<typeof approvalDecisionInput>) {
		return this.run(userId, async (tx) => {
			await this.requireManager(tx, userId);
			const approval = await tx.outreachApproval.findUniqueOrThrow({ where: { id: input.id }, select: { draftId: true, requestedById: true, status: true, draft: { select: { recipientRouteId: true, recipientRoute: { select: { contact: { select: { lifecycleState: true } } } } } } } });
			const consent = approval.draft.recipientRouteId ? await tx.contactRouteConsent.findUnique({ where: { routeId: approval.draft.recipientRouteId } }) : null;
			if (approval.requestedById === userId || approval.status !== "PENDING") throw new ForbiddenException("The requester cannot decide this approval.");
			if (input.status === "APPROVED" && (approval.draft.recipientRoute?.contact?.lifecycleState !== "ACTIVE" || consent?.status === "DO_NOT_CONTACT")) throw new ForbiddenException("DNC or archive state prevents approval.");
			const decidedAt = new Date();
			const result = await tx.outreachApproval.update({ where: { id: input.id }, data: { status: input.status, decidedById: userId, decidedAt, decisionReason: input.reason } });
			await tx.draft.update({ where: { id: approval.draftId }, data: input.status === "APPROVED" ? { status: "APPROVED", approvedAt: decidedAt } : { status: "REJECTED", approvedAt: null } });
			return result;
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
