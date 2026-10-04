import type { Prisma } from "@crm/db";
import {
	COMMERCIAL_ORGANIZATION_DENSITY_LIMIT,
	isPersonProtected,
	isProtectedPlayerContact,
	validateExternalCopy,
} from "@crm/db";
import { canonicalFollowUpStepDueAt } from "./follow-up-cadence";
import { localProviderDoubleEnabled } from "./local-provider-double";
import {
	atlasLiveOutreachEnvironmentEnabled,
	atlasScheduledExecutionEnabled,
} from "./outreach-execution-gates";
import { businessDaysBefore } from "./working-hours";

type CandidateResult = {
	eligible: boolean;
	reason: string | null;
	canonicalDueAt: Date | null;
};

type CandidatePhase =
	| { type: "CLAIMED"; workerId: string }
	| { type: "SENDING_DELIVERY"; deliveryId: string };

export async function evaluateFollowUpCohortCandidate(
	tx: Prisma.TransactionClient,
	stepId: string,
	now: Date,
	phase?: CandidatePhase | null,
): Promise<CandidateResult> {
	const step = await tx.followUpStep.findUnique({
		where: { id: stepId },
		include: {
			plan: true,
			draft: {
				include: {
					mailbox: { select: { address: true, status: true } },
					authorization: {
						select: {
							id: true,
							followUpCohortId: true,
							scope: true,
							status: true,
							expiresAt: true,
						},
					},
					recipientRoute: {
						include: {
							contact: {
								include: {
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
	if (!step)
		return {
			eligible: false,
			reason: "FOLLOW_UP_STEP_NOT_FOUND",
			canonicalDueAt: null,
		};
	const plan = step.plan;
	const draft = step.draft;
	if (
		(!phase && step.status !== "PENDING") ||
		(phase?.type === "CLAIMED" &&
			(step.status !== "LEASED" || step.leaseOwner !== phase.workerId)) ||
		(phase?.type === "SENDING_DELIVERY" && step.status !== "QUEUED")
	)
		return {
			eligible: false,
			reason: "FOLLOW_UP_STEP_NOT_PENDING",
			canonicalDueAt: null,
		};
	if (step.attemptCount >= step.maxAttempts)
		return {
			eligible: false,
			reason: "FOLLOW_UP_ATTEMPTS_EXHAUSTED",
			canonicalDueAt: null,
		};
	if (step.retryAt && step.retryAt > now)
		return {
			eligible: false,
			reason: "FOLLOW_UP_RETRY_NOT_DUE",
			canonicalDueAt: null,
		};
	if (!phase && step.leasedUntil && step.leasedUntil > now)
		return {
			eligible: false,
			reason: "FOLLOW_UP_STEP_LEASED",
			canonicalDueAt: null,
		};
	if (step.dueAt > now)
		return {
			eligible: false,
			reason: "STORED_FOLLOW_UP_TIME_NOT_DUE",
			canonicalDueAt: null,
		};
	if (plan.status !== "ACTIVE" || plan.channel !== "EMAIL")
		return {
			eligible: false,
			reason: "FOLLOW_UP_PLAN_NOT_ACTIVE_EMAIL",
			canonicalDueAt: null,
		};
	if (step.position !== 0 && step.position !== 1)
		return {
			eligible: false,
			reason: "FOLLOW_UP_POSITION_UNSUPPORTED",
			canonicalDueAt: null,
		};
	if (!draft || !plan.sourceDraftId || !plan.leadId)
		return {
			eligible: false,
			reason: "FOLLOW_UP_SOURCE_OR_LEAD_MISSING",
			canonicalDueAt: null,
		};
	if (
		!draft.coldOutreach ||
		draft.status !==
			(phase?.type === "SENDING_DELIVERY" ? "QUEUED" : "DRAFT") ||
		draft.recipientRouteId !== plan.routeId ||
		draft.recipientRouteId !== step.plan.routeId ||
		draft.mailbox?.address.toLowerCase() !== "outreach@iblmedia.com" ||
		draft.mailbox.status !== "VERIFIED"
	)
		return {
			eligible: false,
			reason: "FOLLOW_UP_DRAFT_OR_SENDER_INVALID",
			canonicalDueAt: null,
		};
	if (phase?.type === "SENDING_DELIVERY") {
		const authorization = draft.authorization;
		const member = authorization?.followUpCohortId
			? await tx.followUpExecutionCohortMember.findFirst({
					where: {
						cohortId: authorization.followUpCohortId,
						followUpStepId: step.id,
						status: "QUEUED",
						cohort: { state: { in: ["ACTIVE", "COMPLETED"] } },
					},
					select: { id: true },
				})
			: null;
		const delivery = await tx.outboundDelivery.findUnique({
			where: { idempotencyKey: `followup-delivery:${step.id}` },
			select: { id: true, status: true },
		});
		const [settings, provider] = await Promise.all([
			tx.appSetting.findUnique({
				where: { id: "app" },
				select: { atlasLiveOutreachEnabled: true },
			}),
			tx.providerCapability.findUnique({
				where: { key: "RESEND_OUTBOUND" },
				select: { status: true },
			}),
		]);
		const authorizationValid = Boolean(
			authorization?.scope === "STANDARD_COLD_OUTREACH" &&
				authorization.status === "ACTIVE" &&
				(authorization.expiresAt === null || authorization.expiresAt > now),
		);
		if (
			!authorizationValid ||
			!member ||
			!delivery ||
			delivery.id !== phase.deliveryId ||
			delivery.status !== "SENDING" ||
			settings?.atlasLiveOutreachEnabled !== true ||
			!atlasLiveOutreachEnvironmentEnabled() ||
			!atlasScheduledExecutionEnabled() ||
			(provider?.status !== "VERIFIED" && !localProviderDoubleEnabled())
		)
			return {
				eligible: false,
				reason: "FOLLOW_UP_COHORT_SEND_GATES_CHANGED",
				canonicalDueAt: null,
			};
	}
	if (!validateExternalCopy({ subject: draft.subject, body: draft.body }).valid)
		return {
			eligible: false,
			reason: "FOLLOW_UP_COPY_POLICY_BLOCKED",
			canonicalDueAt: null,
		};
	const route = draft.recipientRoute;
	const contact = route?.contact;
	if (
		route?.type !== "EMAIL" ||
		route.lifecycleState !== "ACTIVE" ||
		!route.verifiedAt ||
		route.contactId !== plan.contactId ||
		contact?.lifecycleState !== "ACTIVE" ||
		contact.outreachState !== "ALLOWED" ||
		!/^\S+@\S+\.\S+$/.test(route.normalizedValue)
	)
		return {
			eligible: false,
			reason: "FOLLOW_UP_IDENTITY_OR_ROUTE_UNRESOLVED",
			canonicalDueAt: null,
		};
	if (!contact.companyId || contact.company?.lifecycleState !== "ACTIVE")
		return {
			eligible: false,
			reason: "FOLLOW_UP_ORGANIZATION_UNRESOLVED",
			canonicalDueAt: null,
		};
	const lead = contact.leads.find((candidate) => candidate.id === plan.leadId);
	if (
		!lead ||
		lead.companyId !== contact.companyId ||
		lead.stage !== "CONTACTED" ||
		lead.attentionState !== "NONE" ||
		lead.lastRepliedAt !== null
	)
		return {
			eligible: false,
			reason: "FOLLOW_UP_OPPORTUNITY_NOT_OPEN",
			canonicalDueAt: null,
		};
	const [routeCollision, duplicateOpportunity, recentOrganizationLeads] =
		await Promise.all([
			tx.contactRoute.findFirst({
				where: {
					id: { not: route.id },
					contactId: { not: contact.id },
					type: "EMAIL",
					lifecycleState: "ACTIVE",
					normalizedValue: route.normalizedValue,
				},
				select: { id: true },
			}),
			lead.commercialOpportunityCollisionKey
				? tx.lead.findFirst({
						where: {
							id: { not: lead.id },
							companyId: contact.companyId,
							commercialOpportunityCollisionKey:
								lead.commercialOpportunityCollisionKey,
							stage: { notIn: ["LOST", "WON"] },
							status: { not: "DISQUALIFIED" },
						},
						select: { id: true },
					})
				: Promise.resolve(null),
			tx.lead.findMany({
				where: {
					id: { not: lead.id },
					companyId: contact.companyId,
					commercialOpportunityCollisionKey: { not: null },
					lastContactedAt: { gte: businessDaysBefore(now, 5) },
					stage: { notIn: ["LOST", "WON"] },
					status: { not: "DISQUALIFIED" },
				},
				select: { commercialOpportunityCollisionKey: true },
			}),
		]);
	if (routeCollision)
		return {
			eligible: false,
			reason: "FOLLOW_UP_ROUTE_COLLISION",
			canonicalDueAt: null,
		};
	if (duplicateOpportunity)
		return {
			eligible: false,
			reason: "FOLLOW_UP_DUPLICATE_OPPORTUNITY",
			canonicalDueAt: null,
		};
	const organizationOpportunityKeys = new Set(
		recentOrganizationLeads
			.map((row) => row.commercialOpportunityCollisionKey)
			.filter((key): key is string => Boolean(key)),
	);
	if (organizationOpportunityKeys.size >= COMMERCIAL_ORGANIZATION_DENSITY_LIMIT)
		return {
			eligible: false,
			reason: "FOLLOW_UP_ORGANIZATION_DENSITY_LIMIT",
			canonicalDueAt: null,
		};
	if (await isPersonProtected(tx, contact.id))
		return {
			eligible: false,
			reason: "PERSON_OWNER_PROTECTED",
			canonicalDueAt: null,
		};
	if (
		await isProtectedPlayerContact(
			tx,
			contact.id,
			`${contact.firstName} ${contact.lastName ?? ""}`,
		)
	)
		return {
			eligible: false,
			reason: "DO_NOT_PROSPECT_PLAYER",
			canonicalDueAt: null,
		};
	if (
		await tx.organizationProtection.findFirst({
			where: { companyId: contact.companyId, status: "ACTIVE" },
			select: { id: true },
		})
	)
		return {
			eligible: false,
			reason: "ORGANIZATION_OWNER_PROTECTED",
			canonicalDueAt: null,
		};
	if (
		await tx.contactRouteConsent.findFirst({
			where: {
				routeId: route.id,
				status: "DO_NOT_CONTACT",
			},
			select: { id: true },
		})
	)
		return {
			eligible: false,
			reason: "ROUTE_DO_NOT_CONTACT",
			canonicalDueAt: null,
		};
	if (
		await tx.outboundDelivery.findFirst({
			where: {
				status: { in: ["BOUNCED", "COMPLAINED"] },
				draft: { recipientRouteId: route.id },
			},
			select: { id: true },
		})
	)
		return {
			eligible: false,
			reason: "BOUNCED_OR_COMPLAINED_ROUTE",
			canonicalDueAt: null,
		};
	const [sharedSuppression, suppressedAddress] = await Promise.all([
		tx.outreachSuppression.findFirst({
			where: {
				OR: [
					{
						scope: "CONTACT",
						contactId: contact.id,
						OR: [{ channel: null }, { channel: "EMAIL" }],
					},
					{
						scope: "ROUTE",
						routeId: route.id,
						OR: [{ channel: null }, { channel: "EMAIL" }],
					},
					{
						scope: "ORGANIZATION",
						companyId: contact.companyId,
						OR: [{ channel: null }, { channel: "EMAIL" }],
					},
				],
			},
			select: { id: true },
		}),
		tx.suppressedContact.findUnique({
			where: { email: route.normalizedValue.trim().toLowerCase() },
			select: { email: true },
		}),
	]);
	if (sharedSuppression || suppressedAddress)
		return {
			eligible: false,
			reason: "OUTREACH_SUPPRESSED",
			canonicalDueAt: null,
		};
	const routeDomain = route.normalizedValue.split("@").at(-1);
	if (
		routeDomain &&
		(await tx.suppressedDomain.findUnique({
			where: { domain: routeDomain },
			select: { domain: true },
		}))
	)
		return {
			eligible: false,
			reason: "ORGANIZATION_DOMAIN_SUPPRESSED",
			canonicalDueAt: null,
		};
	if (
		await tx.channelEngagementState.findFirst({
			where: {
				contactId: contact.id,
				status: { in: ["ACTIVE_HUMAN_CONVERSATION", "NEEDS_IHSAN"] },
			},
			select: { id: true },
		})
	)
		return {
			eligible: false,
			reason: "ACTIVE_CROSS_CHANNEL_RELATIONSHIP",
			canonicalDueAt: null,
		};
	const contactOnce = await tx.relationshipColdTouchClaim.findUnique({
		where: { contactId: contact.id },
		select: { leadId: true, channel: true, status: true },
	});
	if (
		!contactOnce ||
		contactOnce?.leadId !== plan.leadId ||
		contactOnce.channel !== "EMAIL" ||
		contactOnce.status !== "CONSUMED"
	)
		return {
			eligible: false,
			reason: "CONTACT_ONCE_STATE_UNRESOLVED",
			canonicalDueAt: null,
		};
	const activePlans = await tx.followUpPlan.count({
		where: {
			contactId: contact.id,
			channel: "EMAIL",
			status: "ACTIVE",
		},
	});
	if (activePlans !== 1)
		return {
			eligible: false,
			reason: "DUPLICATE_ACTIVE_FOLLOW_UP_PLAN",
			canonicalDueAt: null,
		};
	const originalDelivery = await tx.outboundDelivery.findFirst({
		where: {
			draftId: plan.sourceDraftId,
			status: { in: ["SENT", "DELIVERED"] },
		},
		orderBy: { sentAt: "desc" },
		select: { sentAt: true },
	});
	if (!originalDelivery?.sentAt)
		return {
			eligible: false,
			reason: "ORIGINAL_COLD_DELIVERY_UNVERIFIED",
			canonicalDueAt: null,
		};
	let previousFollowUpSentAt: Date | null = null;
	if (step.position === 1) {
		const firstStep = await tx.followUpStep.findUnique({
			where: { planId_position: { planId: plan.id, position: 0 } },
			select: { id: true, status: true },
		});
		if (firstStep?.status !== "COMPLETED")
			return {
				eligible: false,
				reason: "FOLLOW_UP_ONE_NOT_COMPLETED",
				canonicalDueAt: null,
			};
		const firstDelivery = await tx.outboundDelivery.findUnique({
			where: { idempotencyKey: `followup-delivery:${firstStep.id}` },
			select: { sentAt: true, status: true },
		});
		if (
			!firstDelivery?.sentAt ||
			(firstDelivery.status !== "SENT" && firstDelivery.status !== "DELIVERED")
		)
			return {
				eligible: false,
				reason: "FOLLOW_UP_ONE_DELIVERY_UNVERIFIED",
				canonicalDueAt: null,
			};
		previousFollowUpSentAt = firstDelivery.sentAt;
	}
	const canonicalDueAt = canonicalFollowUpStepDueAt(
		step.position,
		originalDelivery.sentAt,
		previousFollowUpSentAt,
	);
	if (!canonicalDueAt)
		return {
			eligible: false,
			reason: "CANONICAL_FOLLOW_UP_TIME_UNRESOLVED",
			canonicalDueAt: null,
		};
	const effectiveDueAt =
		canonicalDueAt > step.dueAt ? canonicalDueAt : step.dueAt;
	if (effectiveDueAt > now)
		return {
			eligible: false,
			reason: "CANONICAL_FOLLOW_UP_NOT_DUE",
			canonicalDueAt: effectiveDueAt,
		};
	const inbound = await tx.emailMessage.findMany({
		where: {
			thread: { contactId: contact.id },
			direction: "INBOUND",
			sentAt: { gt: originalDelivery.sentAt },
		},
		select: { inboundIntent: true },
	});
	if (inbound.some((message) => message.inboundIntent !== "AUTO_REPLY"))
		return {
			eligible: false,
			reason: "POST_OUTREACH_INBOUND_REQUIRES_REVIEW",
			canonicalDueAt: effectiveDueAt,
		};
	const existingFollowUpDelivery = await tx.outboundDelivery.findUnique({
		where: { idempotencyKey: `followup-delivery:${step.id}` },
		select: { id: true, status: true },
	});
	if (
		existingFollowUpDelivery &&
		(phase?.type !== "SENDING_DELIVERY" ||
			existingFollowUpDelivery.id !== phase.deliveryId ||
			existingFollowUpDelivery.status !== "SENDING")
	)
		return {
			eligible: false,
			reason: "FOLLOW_UP_DELIVERY_ALREADY_EXISTS",
			canonicalDueAt: effectiveDueAt,
		};
	return { eligible: true, reason: null, canonicalDueAt: effectiveDueAt };
}
