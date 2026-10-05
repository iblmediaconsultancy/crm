import type { Db, Prisma } from "@crm/db";
import {
	COMMERCIAL_ORGANIZATION_DENSITY_LIMIT,
	normalizePlayerName,
	validateExternalCopy,
} from "@crm/db";
import { type PrincipalContext, withPrincipal } from "@crm/db/security";
import { canonicalFollowUpStepDueAt } from "./follow-up-cadence";
import { businessDaysBefore } from "./working-hours";

const EMAIL = "EMAIL" as const;
const ACTIVE = "ACTIVE" as const;
const PENDING = "PENDING" as const;
const SENT_DELIVERED = ["SENT", "DELIVERED"] as const;
const BLOCKED_ENGAGEMENTS = [
	"ACTIVE_HUMAN_CONVERSATION",
	"NEEDS_IHSAN",
] as const;

export type BatchFollowUpEvaluation = {
	id: string;
	eligible: boolean;
	reason: string | null;
	canonicalDueAt: Date | null;
};

type Snapshot = Awaited<ReturnType<typeof loadFollowUpCohortSnapshots>>[number];

async function loadFollowUpCohortSnapshots(
	tx: Prisma.TransactionClient,
	stepIds: string[],
	now: Date,
) {
	if (stepIds.length === 0) return [];
	const steps = await tx.followUpStep.findMany({
		where: { id: { in: stepIds } },
		include: {
			plan: {
				select: {
					id: true,
					contactId: true,
					routeId: true,
					leadId: true,
					sourceDraftId: true,
					channel: true,
					status: true,
				},
			},
			draft: {
				select: {
					id: true,
					status: true,
					coldOutreach: true,
					subject: true,
					body: true,
					recipientRouteId: true,
					mailbox: { select: { address: true, status: true } },
					recipientRoute: {
						select: {
							id: true,
							contactId: true,
							type: true,
							lifecycleState: true,
							verifiedAt: true,
							normalizedValue: true,
							contact: {
								select: {
									id: true,
									firstName: true,
									lastName: true,
									lifecycleState: true,
									outreachState: true,
									companyId: true,
									company: {
										select: { id: true, lifecycleState: true },
									},
									leads: {
										select: {
											id: true,
											companyId: true,
											stage: true,
											attentionState: true,
											lastRepliedAt: true,
											commercialOpportunityCollisionKey: true,
										},
									},
								},
							},
						},
					},
				},
			},
		},
	});
	const routes = steps.flatMap((step) =>
		step.draft?.recipientRoute ? [step.draft.recipientRoute] : [],
	);
	const contacts = routes.flatMap((route) =>
		route.contact ? [route.contact] : [],
	);
	const contactIds = [...new Set(contacts.map((contact) => contact.id))];
	const routeIds = [...new Set(routes.map((route) => route.id))];
	const companyIds = [
		...new Set(
			contacts.flatMap((contact) =>
				contact.companyId ? [contact.companyId] : [],
			),
		),
	];
	const planIds = [...new Set(steps.map((step) => step.plan.id))];
	const sourceDraftIds = [
		...new Set(steps.flatMap((step) => step.plan.sourceDraftId ?? [])),
	];
	const normalizedRoutes = [
		...new Set(routes.map((route) => route.normalizedValue)),
	];
	const emails = [
		...new Set(normalizedRoutes.map((value) => value.trim().toLowerCase())),
	];
	const domains = [
		...new Set(normalizedRoutes.map((value) => value.split("@").at(-1) ?? "")),
	].filter(Boolean);
	const normalizedNames = [
		...new Set(
			contacts
				.map((contact) =>
					normalizePlayerName(`${contact.firstName} ${contact.lastName ?? ""}`),
				)
				.filter(Boolean),
		),
	];
	const collisionKeys = [
		...new Set(
			contacts.flatMap((contact) =>
				contact.leads.flatMap((lead) =>
					lead.commercialOpportunityCollisionKey
						? [lead.commercialOpportunityCollisionKey]
						: [],
				),
			),
		),
	];
	const dueFrom = businessDaysBefore(now, 5);
	const activePersonProtections = contactIds.length
		? await tx.personProtection.findMany({
				where: { contactId: { in: contactIds }, status: ACTIVE },
				select: { contactId: true },
			})
		: [];
	const players = contactIds.length
		? await tx.footballPlayer.findMany({
				where: { contactId: { in: contactIds } },
				select: { contactId: true },
			})
		: [];
	const playerContactIds = players.map((player) => player.contactId);
	const playerProtectionOr: Prisma.ProspectPlayerProtectionWhereInput[] = [];
	if (playerContactIds.length)
		playerProtectionOr.push({ contactId: { in: playerContactIds } });
	if (normalizedNames.length) {
		playerProtectionOr.push({ normalizedName: { in: normalizedNames } });
		playerProtectionOr.push({
			aliases: { some: { normalizedName: { in: normalizedNames } } },
		});
	}
	const playerProtections = playerProtectionOr.length
		? await tx.prospectPlayerProtection.findMany({
				where: {
					active: true,
					state: "DO_NOT_PROSPECT_PLAYER",
					OR: playerProtectionOr,
				},
				select: {
					contactId: true,
					normalizedName: true,
					aliases: { select: { normalizedName: true } },
				},
			})
		: [];
	const organizationProtections = companyIds.length
		? await tx.organizationProtection.findMany({
				where: { companyId: { in: companyIds }, status: ACTIVE },
				select: { companyId: true },
			})
		: [];
	const dncRoutes = routeIds.length
		? await tx.contactRouteConsent.findMany({
				where: { routeId: { in: routeIds }, status: "DO_NOT_CONTACT" },
				select: { routeId: true },
			})
		: [];
	const bouncedDeliveries = routeIds.length
		? await tx.outboundDelivery.findMany({
				where: {
					status: { in: ["BOUNCED", "COMPLAINED"] },
					draft: { recipientRouteId: { in: routeIds } },
				},
				select: { draft: { select: { recipientRouteId: true } } },
			})
		: [];
	const suppressionOr: Prisma.OutreachSuppressionWhereInput[] = [];
	if (contactIds.length)
		suppressionOr.push({
			scope: "CONTACT",
			contactId: { in: contactIds },
			OR: [{ channel: null }, { channel: EMAIL }],
		});
	if (routeIds.length)
		suppressionOr.push({
			scope: "ROUTE",
			routeId: { in: routeIds },
			OR: [{ channel: null }, { channel: EMAIL }],
		});
	if (companyIds.length)
		suppressionOr.push({
			scope: "ORGANIZATION",
			companyId: { in: companyIds },
			OR: [{ channel: null }, { channel: EMAIL }],
		});
	const suppressions = suppressionOr.length
		? await tx.outreachSuppression.findMany({
				where: { OR: suppressionOr },
				select: { contactId: true, routeId: true, companyId: true },
			})
		: [];
	const suppressedContacts = emails.length
		? await tx.suppressedContact.findMany({
				where: { email: { in: emails } },
				select: { email: true },
			})
		: [];
	const suppressedDomains = domains.length
		? await tx.suppressedDomain.findMany({
				where: { domain: { in: domains } },
				select: { domain: true },
			})
		: [];
	const activeEngagements = contactIds.length
		? await tx.channelEngagementState.findMany({
				where: {
					contactId: { in: contactIds },
					status: { in: [...BLOCKED_ENGAGEMENTS] },
				},
				select: { contactId: true },
			})
		: [];
	const contactOnceClaims = contactIds.length
		? await tx.relationshipColdTouchClaim.findMany({
				where: { contactId: { in: contactIds } },
				select: { contactId: true, leadId: true, channel: true, status: true },
			})
		: [];
	const activePlans = contactIds.length
		? await tx.followUpPlan.groupBy({
				by: ["contactId"],
				where: {
					contactId: { in: contactIds },
					channel: EMAIL,
					status: ACTIVE,
				},
				_count: { _all: true },
			})
		: [];
	const originalDeliveries = sourceDraftIds.length
		? await tx.outboundDelivery.findMany({
				where: {
					draftId: { in: sourceDraftIds },
					status: { in: [...SENT_DELIVERED] },
				},
				orderBy: { sentAt: "desc" },
				select: { draftId: true, sentAt: true },
			})
		: [];
	const firstSteps = planIds.length
		? await tx.followUpStep.findMany({
				where: { planId: { in: planIds }, position: 0 },
				select: { id: true, planId: true, status: true },
			})
		: [];
	const followUpDeliveryKeys = steps.map(
		(step) => `followup-delivery:${step.id}`,
	);
	const firstDeliveryKeys = firstSteps.map(
		(step) => `followup-delivery:${step.id}`,
	);
	const followUpDeliveries =
		followUpDeliveryKeys.length || firstDeliveryKeys.length
			? await tx.outboundDelivery.findMany({
					where: {
						idempotencyKey: {
							in: [...followUpDeliveryKeys, ...firstDeliveryKeys],
						},
					},
					select: {
						idempotencyKey: true,
						id: true,
						status: true,
						sentAt: true,
					},
				})
			: [];
	const inboundMessages = contactIds.length
		? await tx.emailMessage.findMany({
				where: {
					direction: "INBOUND",
					thread: { contactId: { in: contactIds } },
				},
				select: {
					sentAt: true,
					inboundIntent: true,
					thread: { select: { contactId: true } },
				},
			})
		: [];
	const routeCollisions = normalizedRoutes.length
		? await tx.contactRoute.findMany({
				where: {
					type: EMAIL,
					lifecycleState: ACTIVE,
					normalizedValue: { in: normalizedRoutes },
				},
				select: { id: true, contactId: true, normalizedValue: true },
			})
		: [];
	const duplicateLeads =
		companyIds.length && collisionKeys.length
			? await tx.lead.findMany({
					where: {
						companyId: { in: companyIds },
						commercialOpportunityCollisionKey: { in: collisionKeys },
						stage: { notIn: ["LOST", "WON"] },
						status: { not: "DISQUALIFIED" },
					},
					select: {
						id: true,
						companyId: true,
						commercialOpportunityCollisionKey: true,
					},
				})
			: [];
	const densityLeads = companyIds.length
		? await tx.lead.findMany({
				where: {
					companyId: { in: companyIds },
					commercialOpportunityCollisionKey: { not: null },
					lastContactedAt: { gte: dueFrom },
					stage: { notIn: ["LOST", "WON"] },
					status: { not: "DISQUALIFIED" },
				},
				select: {
					id: true,
					companyId: true,
					commercialOpportunityCollisionKey: true,
				},
			})
		: [];
	const personProtectionIds = new Set(
		activePersonProtections.map((row) => row.contactId),
	);
	const playerIds = new Set(playerContactIds);
	const protectedContactIds = new Set(
		playerProtections.flatMap((row) => (row.contactId ? [row.contactId] : [])),
	);
	const protectedNames = new Set(
		playerProtections.map((row) => row.normalizedName),
	);
	const protectedAliases = new Set(
		playerProtections.flatMap((row) =>
			row.aliases.map((alias) => alias.normalizedName),
		),
	);
	const organizationProtectionIds = new Set(
		organizationProtections.map((row) => row.companyId),
	);
	const dncRouteIds = new Set(dncRoutes.map((row) => row.routeId));
	const bouncedRouteIds = new Set(
		bouncedDeliveries.flatMap((row) =>
			row.draft.recipientRouteId ? [row.draft.recipientRouteId] : [],
		),
	);
	const suppressedContactIds = new Set(
		suppressions.flatMap((row) => (row.contactId ? [row.contactId] : [])),
	);
	const suppressedRouteIds = new Set(
		suppressions.flatMap((row) => (row.routeId ? [row.routeId] : [])),
	);
	const suppressedCompanyIds = new Set(
		suppressions.flatMap((row) => (row.companyId ? [row.companyId] : [])),
	);
	const suppressedEmails = new Set(suppressedContacts.map((row) => row.email));
	const suppressedDomainSet = new Set(
		suppressedDomains.map((row) => row.domain),
	);
	const activeEngagementIds = new Set(
		activeEngagements.map((row) => row.contactId),
	);
	const claimByContact = new Map(
		contactOnceClaims.map((row) => [row.contactId, row]),
	);
	const activePlanCount = new Map(
		activePlans.map((row) => [row.contactId, row._count._all]),
	);
	const originalSentByDraft = new Map<string, Date>();
	for (const delivery of originalDeliveries)
		if (delivery.sentAt && !originalSentByDraft.has(delivery.draftId))
			originalSentByDraft.set(delivery.draftId, delivery.sentAt);
	const firstStepByPlan = new Map(
		firstSteps.map((step) => [step.planId, step]),
	);
	const followUpDeliveryByKey = new Map(
		followUpDeliveries.map((delivery) => [delivery.idempotencyKey, delivery]),
	);
	const densityKeysByCompany = new Map<string, Set<string>>();
	for (const row of densityLeads) {
		if (!row.companyId || !row.commercialOpportunityCollisionKey) continue;
		const keys = densityKeysByCompany.get(row.companyId) ?? new Set<string>();
		keys.add(row.commercialOpportunityCollisionKey);
		densityKeysByCompany.set(row.companyId, keys);
	}
	return steps.map((step) => ({
		step,
		now,
		personProtected: Boolean(
			step.draft?.recipientRoute?.contact &&
				personProtectionIds.has(step.draft.recipientRoute.contact.id),
		),
		playerProtected: Boolean(
			step.draft?.recipientRoute?.contact &&
				playerIds.has(step.draft.recipientRoute.contact.id) &&
				(protectedContactIds.has(step.draft.recipientRoute.contact.id) ||
					protectedNames.has(
						normalizePlayerName(
							`${step.draft.recipientRoute.contact.firstName} ${step.draft.recipientRoute.contact.lastName ?? ""}`,
						),
					) ||
					protectedAliases.has(
						normalizePlayerName(
							`${step.draft.recipientRoute.contact.firstName} ${step.draft.recipientRoute.contact.lastName ?? ""}`,
						),
					)),
		),
		organizationProtected: Boolean(
			step.draft?.recipientRoute?.contact?.companyId &&
				organizationProtectionIds.has(
					step.draft.recipientRoute.contact.companyId,
				),
		),
		routeDnc: Boolean(
			step.draft?.recipientRoute &&
				dncRouteIds.has(step.draft.recipientRoute.id),
		),
		bounced: Boolean(
			step.draft?.recipientRoute &&
				bouncedRouteIds.has(step.draft.recipientRoute.id),
		),
		sharedSuppression: Boolean(
			step.draft?.recipientRoute?.contact &&
				(suppressedContactIds.has(step.draft.recipientRoute.contact.id) ||
					suppressedRouteIds.has(step.draft.recipientRoute.id) ||
					(step.draft.recipientRoute.contact.companyId &&
						suppressedCompanyIds.has(
							step.draft.recipientRoute.contact.companyId,
						))),
		),
		suppressedAddress: Boolean(
			step.draft?.recipientRoute &&
				suppressedEmails.has(
					step.draft.recipientRoute.normalizedValue.trim().toLowerCase(),
				),
		),
		domainSuppressed: Boolean(
			step.draft?.recipientRoute &&
				suppressedDomainSet.has(
					step.draft.recipientRoute.normalizedValue.split("@").at(-1) ?? "",
				),
		),
		crossChannelConversation: Boolean(
			step.draft?.recipientRoute?.contact &&
				activeEngagementIds.has(step.draft.recipientRoute.contact.id),
		),
		contactOnce: step.draft?.recipientRoute?.contact
			? (claimByContact.get(step.draft.recipientRoute.contact.id) ?? null)
			: null,
		activePlans: step.plan.contactId
			? (activePlanCount.get(step.plan.contactId) ?? 0)
			: 0,
		originalSentAt: step.plan.sourceDraftId
			? (originalSentByDraft.get(step.plan.sourceDraftId) ?? null)
			: null,
		firstStep: firstStepByPlan.get(step.planId) ?? null,
		followUpDelivery:
			followUpDeliveryByKey.get(`followup-delivery:${step.id}`) ?? null,
		firstFollowUpDelivery: firstStepByPlan.get(step.planId)
			? (followUpDeliveryByKey.get(
					`followup-delivery:${firstStepByPlan.get(step.planId)?.id}`,
				) ?? null)
			: null,
		inboundMessages: step.draft?.recipientRoute?.contact
			? inboundMessages.filter(
					(message) =>
						message.thread.contactId ===
						step.draft?.recipientRoute?.contact?.id,
				)
			: [],
		routeCollision: Boolean(
			step.draft?.recipientRoute?.contact &&
				routeCollisions.some(
					(row) =>
						row.id !== step.draft?.recipientRoute?.id &&
						row.contactId !== step.draft?.recipientRoute?.contact?.id &&
						row.normalizedValue === step.draft?.recipientRoute?.normalizedValue,
				),
		),
		duplicateOpportunity: Boolean(
			step.draft?.recipientRoute?.contact &&
				step.plan.leadId &&
				step.draft.recipientRoute.contact.companyId &&
				(() => {
					const lead = step.draft?.recipientRoute?.contact?.leads.find(
						(candidate) => candidate.id === step.plan.leadId,
					);
					return (
						lead?.commercialOpportunityCollisionKey &&
						duplicateLeads.some(
							(row) =>
								row.id !== lead.id &&
								row.companyId ===
									step.draft?.recipientRoute?.contact?.companyId &&
								row.commercialOpportunityCollisionKey ===
									lead.commercialOpportunityCollisionKey,
						)
					);
				})(),
		),
		organizationOpportunityKeys: new Set(
			densityLeads
				.filter(
					(row) =>
						row.id !== step.plan.leadId &&
						row.companyId === step.draft?.recipientRoute?.contact?.companyId &&
						row.commercialOpportunityCollisionKey,
				)
				.map((row) => row.commercialOpportunityCollisionKey as string),
		),
		hasExistingFollowUpDelivery: Boolean(
			followUpDeliveryByKey.get(`followup-delivery:${step.id}`),
		),
	}));
}

function evaluateSnapshot(snapshot: Snapshot): BatchFollowUpEvaluation {
	const { step, now } = snapshot;
	const plan = step.plan;
	const draft = step.draft;
	const originalSentAt = snapshot.originalSentAt;
	const route = draft?.recipientRoute;
	const contact = route?.contact;
	const blocked = (reason: string, canonicalDueAt: Date | null = null) => ({
		id: step.id,
		eligible: false,
		reason,
		canonicalDueAt,
	});
	if (step.status !== PENDING) return blocked("FOLLOW_UP_STEP_NOT_PENDING");
	if (step.attemptCount >= step.maxAttempts)
		return blocked("FOLLOW_UP_ATTEMPTS_EXHAUSTED");
	if (step.retryAt && step.retryAt > now)
		return blocked("FOLLOW_UP_RETRY_NOT_DUE");
	if (step.leasedUntil && step.leasedUntil > now)
		return blocked("FOLLOW_UP_STEP_LEASED");
	if (step.dueAt > now) return blocked("STORED_FOLLOW_UP_TIME_NOT_DUE");
	if (plan.status !== ACTIVE || plan.channel !== EMAIL)
		return blocked("FOLLOW_UP_PLAN_NOT_ACTIVE_EMAIL");
	if (step.position !== 0 && step.position !== 1)
		return blocked("FOLLOW_UP_POSITION_UNSUPPORTED");
	if (!draft || !plan.sourceDraftId || !plan.leadId)
		return blocked("FOLLOW_UP_SOURCE_OR_LEAD_MISSING");
	if (
		!draft.coldOutreach ||
		draft.status !== "DRAFT" ||
		draft.recipientRouteId !== plan.routeId ||
		draft.recipientRouteId !== step.plan.routeId ||
		draft.mailbox?.address.toLowerCase() !== "outreach@iblmedia.com" ||
		draft.mailbox.status !== "VERIFIED"
	)
		return blocked("FOLLOW_UP_DRAFT_OR_SENDER_INVALID");
	if (!validateExternalCopy({ subject: draft.subject, body: draft.body }).valid)
		return blocked("FOLLOW_UP_COPY_POLICY_BLOCKED");
	if (
		route?.type !== EMAIL ||
		route.lifecycleState !== ACTIVE ||
		!route.verifiedAt ||
		route.contactId !== plan.contactId ||
		contact?.lifecycleState !== ACTIVE ||
		contact.outreachState !== "ALLOWED" ||
		!/^\S+@\S+\.\S+$/.test(route.normalizedValue)
	)
		return blocked("FOLLOW_UP_IDENTITY_OR_ROUTE_UNRESOLVED");
	if (!contact.companyId || contact.company?.lifecycleState !== ACTIVE)
		return blocked("FOLLOW_UP_ORGANIZATION_UNRESOLVED");
	const lead = contact.leads.find((candidate) => candidate.id === plan.leadId);
	if (
		!lead ||
		lead.companyId !== contact.companyId ||
		lead.stage !== "CONTACTED" ||
		lead.attentionState !== "NONE" ||
		lead.lastRepliedAt !== null
	)
		return blocked("FOLLOW_UP_OPPORTUNITY_NOT_OPEN");
	if (snapshot.routeCollision) return blocked("FOLLOW_UP_ROUTE_COLLISION");
	if (snapshot.duplicateOpportunity)
		return blocked("FOLLOW_UP_DUPLICATE_OPPORTUNITY");
	if (
		snapshot.organizationOpportunityKeys.size >=
		COMMERCIAL_ORGANIZATION_DENSITY_LIMIT
	)
		return blocked("FOLLOW_UP_ORGANIZATION_DENSITY_LIMIT");
	if (snapshot.personProtected) return blocked("PERSON_OWNER_PROTECTED");
	if (snapshot.playerProtected) return blocked("DO_NOT_PROSPECT_PLAYER");
	if (snapshot.organizationProtected)
		return blocked("ORGANIZATION_OWNER_PROTECTED");
	if (snapshot.routeDnc) return blocked("ROUTE_DO_NOT_CONTACT");
	if (snapshot.bounced) return blocked("BOUNCED_OR_COMPLAINED_ROUTE");
	if (snapshot.sharedSuppression || snapshot.suppressedAddress)
		return blocked("OUTREACH_SUPPRESSED");
	if (snapshot.domainSuppressed)
		return blocked("ORGANIZATION_DOMAIN_SUPPRESSED");
	if (snapshot.crossChannelConversation)
		return blocked("ACTIVE_CROSS_CHANNEL_RELATIONSHIP");
	if (
		!snapshot.contactOnce ||
		snapshot.contactOnce.leadId !== plan.leadId ||
		snapshot.contactOnce.channel !== EMAIL ||
		snapshot.contactOnce.status !== "CONSUMED"
	)
		return blocked("CONTACT_ONCE_STATE_UNRESOLVED");
	if (snapshot.activePlans !== 1)
		return blocked("DUPLICATE_ACTIVE_FOLLOW_UP_PLAN");
	if (!originalSentAt) return blocked("ORIGINAL_COLD_DELIVERY_UNVERIFIED");
	let previousFollowUpSentAt: Date | null = null;
	if (step.position === 1) {
		if (snapshot.firstStep?.status !== "COMPLETED")
			return blocked("FOLLOW_UP_ONE_NOT_COMPLETED");
		if (
			!snapshot.firstFollowUpDelivery?.sentAt ||
			!SENT_DELIVERED.includes(
				snapshot.firstFollowUpDelivery
					.status as (typeof SENT_DELIVERED)[number],
			)
		)
			return blocked("FOLLOW_UP_ONE_DELIVERY_UNVERIFIED");
		previousFollowUpSentAt = snapshot.firstFollowUpDelivery.sentAt;
	}
	const canonicalDueAt = canonicalFollowUpStepDueAt(
		step.position,
		originalSentAt,
		previousFollowUpSentAt,
	);
	if (!canonicalDueAt) return blocked("CANONICAL_FOLLOW_UP_TIME_UNRESOLVED");
	const effectiveDueAt =
		canonicalDueAt > step.dueAt ? canonicalDueAt : step.dueAt;
	if (effectiveDueAt > now)
		return blocked("CANONICAL_FOLLOW_UP_NOT_DUE", effectiveDueAt);
	if (
		snapshot.inboundMessages.some(
			(message) =>
				message.sentAt > originalSentAt &&
				message.inboundIntent !== "AUTO_REPLY",
		)
	)
		return blocked("POST_OUTREACH_INBOUND_REQUIRES_REVIEW", effectiveDueAt);
	if (snapshot.hasExistingFollowUpDelivery)
		return blocked("FOLLOW_UP_DELIVERY_ALREADY_EXISTS", effectiveDueAt);
	return {
		id: step.id,
		eligible: true,
		reason: null,
		canonicalDueAt: effectiveDueAt,
	};
}

export async function evaluateFollowUpCohortBatch(
	tx: Prisma.TransactionClient,
	stepIds: string[],
	now: Date,
) {
	const snapshots = await loadFollowUpCohortSnapshots(tx, stepIds, now);
	const byId = new Map(
		snapshots.map((snapshot) => [snapshot.step.id, snapshot]),
	);
	return stepIds.map((id) => {
		const snapshot = byId.get(id);
		return snapshot
			? evaluateSnapshot(snapshot)
			: {
					id,
					eligible: false,
					reason: "FOLLOW_UP_STEP_NOT_FOUND",
					canonicalDueAt: null,
				};
	});
}

export async function evaluateFollowUpCohortBatchWithPrincipal(
	db: Db,
	principal: PrincipalContext,
	stepIds: string[],
	now: Date,
	batchSize = 50,
) {
	const results: BatchFollowUpEvaluation[] = [];
	for (let offset = 0; offset < stepIds.length; offset += batchSize) {
		const ids = stepIds.slice(offset, offset + batchSize);
		results.push(
			...(await withPrincipal(db, principal, (tx) =>
				evaluateFollowUpCohortBatch(tx, ids, now),
			)),
		);
	}
	return results;
}
