import { describe, expect, test } from "bun:test";
import type { Prisma } from "@crm/db";
import { evaluateFollowUpCohortCandidate } from "../src/providers/follow-up-cohort-preflight";

type Scenario = {
	organizationMissing?: boolean;
	personProtected?: boolean;
	organizationProtected?: boolean;
	routeDnc?: boolean;
	bounced?: boolean;
	suppressed?: boolean;
	suppressedEmail?: boolean;
	domainSuppressed?: boolean;
	crossChannelConversation?: boolean;
	humanReply?: boolean;
	activePlanCount?: number;
	deliveryAlreadyExists?: boolean;
	playerProtected?: boolean;
	unsafeCopy?: boolean;
	fu2?: boolean;
	sendingDelivery?: boolean;
	liveGateOff?: boolean;
	routeCollision?: boolean;
	duplicateOpportunity?: boolean;
	organizationDensityCount?: number;
};

function fixture(
	scenario: Scenario = {},
	now = new Date("2026-10-04T12:00:00.000Z"),
) {
	const contactId = "contact-1";
	const companyId = scenario.organizationMissing ? null : "company-1";
	const routeId = "route-1";
	const leadId = "lead-1";
	const planId = "plan-1";
	const coldDraftId = "cold-draft-1";
	const stepId = scenario.fu2 ? "step-fu2" : "step-fu1";
	const firstStepId = "step-fu1";
	const coldSentAt = new Date("2026-08-01T12:00:00.000Z");
	const firstFollowUpSentAt = new Date(now.getTime());
	const route = {
		id: routeId,
		type: "EMAIL",
		lifecycleState: "ACTIVE",
		verifiedAt: new Date("2026-07-01T12:00:00.000Z"),
		contactId,
		normalizedValue: "agent@example.test",
		contact: {
			id: contactId,
			firstName: "Alex",
			lastName: "Agent",
			lifecycleState: "ACTIVE",
			outreachState: "ALLOWED",
			companyId,
			company: companyId ? { id: companyId, lifecycleState: "ACTIVE" } : null,
			leads: [
				{
					id: leadId,
					companyId,
					stage: "CONTACTED",
					attentionState: "NONE",
					lastRepliedAt: null,
					commercialOpportunityCollisionKey: scenario.duplicateOpportunity
						? "collision-key"
						: null,
				},
			],
		},
	};
	const draft = {
		id: scenario.fu2 ? "fu2-draft" : "fu1-draft",
		status: "DRAFT",
		coldOutreach: true,
		subject: "A quick follow-up",
		body: scenario.unsafeCopy
			? "Our packages start at €500/month."
			: "Checking back on the note I sent.",
		recipientRouteId: routeId,
		mailbox: { address: "outreach@iblmedia.com", status: "VERIFIED" },
		recipientRoute: route,
		authorization: null as {
			id: string;
			followUpCohortId: string;
			scope: string;
			status: string;
			expiresAt: Date;
		} | null,
	};
	const step = {
		id: stepId,
		position: scenario.fu2 ? 1 : 0,
		status: "PENDING",
		attemptCount: 0,
		maxAttempts: 5,
		retryAt: null,
		leasedUntil: null,
		dueAt: new Date(now.getTime() - 86_400_000),
		plan: {
			id: planId,
			contactId,
			routeId,
			leadId,
			sourceDraftId: coldDraftId,
			channel: "EMAIL",
			status: "ACTIVE",
		},
		draft,
	};
	const tx = {
		followUpStep: {
			findUnique: async ({
				where,
			}: {
				where: {
					id: string;
					planId_position?: { planId: string; position: number };
				};
			}) => {
				if (where.id) return step;
				return { id: firstStepId, status: "COMPLETED" };
			},
		},
		personProtection: {
			findFirst: async () =>
				scenario.personProtected ? { id: "person-protection" } : null,
		},
		footballPlayer: {
			findUnique: async () => (scenario.playerProtected ? { contactId } : null),
		},
		prospectPlayerProtection: {
			findFirst: async () =>
				scenario.playerProtected ? { id: "player-protection" } : null,
		},
		organizationProtection: {
			findFirst: async () =>
				scenario.organizationProtected
					? { id: "organization-protection" }
					: null,
		},
		contactRouteConsent: {
			findFirst: async () =>
				scenario.routeDnc ? { id: "route-consent" } : null,
		},
		contactRoute: {
			findFirst: async () =>
				scenario.routeCollision ? { id: "route-collision" } : null,
		},
		lead: {
			findFirst: async () =>
				scenario.duplicateOpportunity ? { id: "duplicate-lead" } : null,
			findMany: async () =>
				Array.from(
					{ length: scenario.organizationDensityCount ?? 0 },
					(_value, index) => ({
						commercialOpportunityCollisionKey: `org-opportunity-${index}`,
					}),
				),
		},
		outboundDelivery: {
			findFirst: async ({
				where,
			}: {
				where: { status?: { in?: string[] }; draftId?: string };
			}) => {
				if (where.status?.in?.includes("BOUNCED"))
					return scenario.bounced ? { id: "bounced-delivery" } : null;
				return { sentAt: coldSentAt };
			},
			findUnique: async ({ where }: { where: { idempotencyKey: string } }) => {
				if (
					scenario.fu2 &&
					where.idempotencyKey === `followup-delivery:${firstStepId}`
				)
					return { status: "SENT", sentAt: firstFollowUpSentAt };
				if (
					scenario.sendingDelivery &&
					where.idempotencyKey === `followup-delivery:${stepId}`
				)
					return { id: "sending-delivery-1", status: "SENDING" };
				return scenario.deliveryAlreadyExists
					? { id: "existing-delivery" }
					: null;
			},
		},
		outreachSuppression: {
			findFirst: async () =>
				scenario.suppressed ? { id: "suppression" } : null,
		},
		suppressedContact: {
			findUnique: async () =>
				scenario.suppressedEmail ? { email: "agent@example.test" } : null,
		},
		suppressedDomain: {
			findUnique: async () =>
				scenario.domainSuppressed ? { domain: "example.test" } : null,
		},
		channelEngagementState: {
			findFirst: async () =>
				scenario.crossChannelConversation ? { id: "engagement" } : null,
		},
		relationshipColdTouchClaim: {
			findUnique: async () => ({
				leadId,
				channel: "EMAIL",
				status: "CONSUMED",
			}),
		},
		followUpPlan: {
			count: async () => scenario.activePlanCount ?? 1,
		},
		followUpExecutionCohortMember: {
			findFirst: async () => ({ id: "cohort-member-1" }),
		},
		appSetting: {
			findUnique: async () => ({
				atlasLiveOutreachEnabled: !scenario.liveGateOff,
			}),
		},
		providerCapability: {
			findUnique: async () => ({ status: "VERIFIED" }),
		},
		emailMessage: {
			findMany: async () =>
				scenario.humanReply ? [{ inboundIntent: "HUMAN_NEUTRAL" }] : [],
		},
	};
	return {
		tx: tx as unknown as Prisma.TransactionClient,
		stepId,
		now,
		step,
		draft,
	};
}

describe("follow-up cohort execution-time preflight", () => {
	test("admits a fully eligible, canonically due FU1", async () => {
		const { tx, stepId, now } = fixture();
		await expect(
			evaluateFollowUpCohortCandidate(tx, stepId, now),
		).resolves.toMatchObject({
			eligible: true,
			reason: null,
		});
	});

	test("excludes an unresolved organization", async () => {
		const { tx, stepId, now } = fixture({ organizationMissing: true });
		await expect(
			evaluateFollowUpCohortCandidate(tx, stepId, now),
		).resolves.toMatchObject({
			eligible: false,
			reason: "FOLLOW_UP_ORGANIZATION_UNRESOLVED",
		});
	});

	test("rejects FU2 whose stored dueAt passed but canonical 5+5 timing is still future", async () => {
		const { tx, stepId, now } = fixture({ fu2: true });
		await expect(
			evaluateFollowUpCohortCandidate(tx, stepId, now),
		).resolves.toMatchObject({
			eligible: false,
			reason: "CANONICAL_FOLLOW_UP_NOT_DUE",
			canonicalDueAt: expect.any(Date),
		});
	});

	test("rechecks queued cohort follow-ups immediately before provider submission", async () => {
		const previousLive = process.env.ATLAS_LIVE_OUTREACH_ENABLED;
		const previousScheduled = process.env.ATLAS_SCHEDULED_EXECUTION_ENABLED;
		process.env.ATLAS_LIVE_OUTREACH_ENABLED = "true";
		process.env.ATLAS_SCHEDULED_EXECUTION_ENABLED = "true";
		try {
			const scenario: Scenario = { sendingDelivery: true };
			const { tx, stepId, now, step, draft } = fixture(scenario);
			step.status = "QUEUED";
			step.attemptCount = 1;
			draft.status = "QUEUED";
			draft.authorization = {
				id: "authorization-1",
				followUpCohortId: "cohort-1",
				scope: "STANDARD_COLD_OUTREACH",
				status: "ACTIVE",
				expiresAt: new Date(now.getTime() + 60_000),
			};
			const phase = {
				type: "SENDING_DELIVERY" as const,
				deliveryId: "sending-delivery-1",
			};
			await expect(
				evaluateFollowUpCohortCandidate(tx, stepId, now, phase),
			).resolves.toMatchObject({ eligible: true });
			scenario.humanReply = true;
			await expect(
				evaluateFollowUpCohortCandidate(tx, stepId, now, phase),
			).resolves.toMatchObject({
				eligible: false,
				reason: "POST_OUTREACH_INBOUND_REQUIRES_REVIEW",
			});
			scenario.humanReply = false;
			scenario.liveGateOff = true;
			await expect(
				evaluateFollowUpCohortCandidate(tx, stepId, now, phase),
			).resolves.toMatchObject({
				eligible: false,
				reason: "FOLLOW_UP_COHORT_SEND_GATES_CHANGED",
			});
		} finally {
			if (previousLive === undefined)
				delete process.env.ATLAS_LIVE_OUTREACH_ENABLED;
			else process.env.ATLAS_LIVE_OUTREACH_ENABLED = previousLive;
			if (previousScheduled === undefined)
				delete process.env.ATLAS_SCHEDULED_EXECUTION_ENABLED;
			else process.env.ATLAS_SCHEDULED_EXECUTION_ENABLED = previousScheduled;
		}
	});

	test.each([
		[{ humanReply: true }, "POST_OUTREACH_INBOUND_REQUIRES_REVIEW"],
		[{ routeCollision: true }, "FOLLOW_UP_ROUTE_COLLISION"],
		[{ duplicateOpportunity: true }, "FOLLOW_UP_DUPLICATE_OPPORTUNITY"],
		[{ organizationDensityCount: 2 }, "FOLLOW_UP_ORGANIZATION_DENSITY_LIMIT"],
		[{ personProtected: true }, "PERSON_OWNER_PROTECTED"],
		[{ playerProtected: true }, "DO_NOT_PROSPECT_PLAYER"],
		[{ organizationProtected: true }, "ORGANIZATION_OWNER_PROTECTED"],
		[{ routeDnc: true }, "ROUTE_DO_NOT_CONTACT"],
		[{ bounced: true }, "BOUNCED_OR_COMPLAINED_ROUTE"],
		[{ suppressed: true }, "OUTREACH_SUPPRESSED"],
		[{ suppressedEmail: true }, "OUTREACH_SUPPRESSED"],
		[{ domainSuppressed: true }, "ORGANIZATION_DOMAIN_SUPPRESSED"],
		[{ unsafeCopy: true }, "FOLLOW_UP_COPY_POLICY_BLOCKED"],
		[{ crossChannelConversation: true }, "ACTIVE_CROSS_CHANNEL_RELATIONSHIP"],
		[{ activePlanCount: 2 }, "DUPLICATE_ACTIVE_FOLLOW_UP_PLAN"],
		[{ deliveryAlreadyExists: true }, "FOLLOW_UP_DELIVERY_ALREADY_EXISTS"],
	] as Array<[Scenario, string]>)(
		"blocks changed or duplicate state with %s",
		async (scenario, reason) => {
			const { tx, stepId, now } = fixture(scenario);
			await expect(
				evaluateFollowUpCohortCandidate(tx, stepId, now),
			).resolves.toMatchObject({
				eligible: false,
				reason,
			});
		},
	);
});
