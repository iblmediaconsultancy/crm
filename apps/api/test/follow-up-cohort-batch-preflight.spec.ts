import { describe, expect, test } from "bun:test";
import type { Db, Prisma } from "@crm/db";
import {
	evaluateFollowUpCohortBatch,
	evaluateFollowUpCohortBatchWithPrincipal,
} from "../src/providers/follow-up-cohort-batch-preflight";

const now = new Date("2026-10-05T07:00:00.000Z");
const sentAt = new Date("2026-09-28T07:00:00.000Z");

function eligibleStep() {
	const contactId = "contact-1";
	const companyId = "company-1";
	const routeId = "route-1";
	const leadId = "lead-1";
	const planId = "plan-1";
	const sourceDraftId = "source-draft-1";
	return {
		contactId,
		companyId,
		routeId,
		leadId,
		planId,
		sourceDraftId,
		step: {
			id: "step-1",
			planId,
			position: 0,
			status: "PENDING",
			attemptCount: 0,
			maxAttempts: 5,
			retryAt: null,
			leasedUntil: null,
			dueAt: new Date("2026-09-29T07:00:00.000Z"),
			plan: {
				id: planId,
				contactId,
				routeId,
				leadId,
				sourceDraftId,
				channel: "EMAIL",
				status: "ACTIVE",
			},
			draft: {
				id: "follow-up-draft-1",
				status: "DRAFT",
				coldOutreach: true,
				subject: "A quick follow-up",
				body: "Checking back on the note I sent.",
				recipientRouteId: routeId,
				mailbox: { address: "outreach@iblmedia.com", status: "VERIFIED" },
				recipientRoute: {
					id: routeId,
					contactId,
					type: "EMAIL",
					lifecycleState: "ACTIVE",
					verifiedAt: new Date("2026-07-01T07:00:00.000Z"),
					normalizedValue: "agent@example.test",
					contact: {
						id: contactId,
						firstName: "Alex",
						lastName: "Agent",
						lifecycleState: "ACTIVE",
						outreachState: "ALLOWED",
						companyId,
						company: { id: companyId, lifecycleState: "ACTIVE" },
						leads: [
							{
								id: leadId,
								companyId,
								stage: "CONTACTED",
								attentionState: "NONE",
								lastRepliedAt: null,
								commercialOpportunityCollisionKey: "opportunity-1",
							},
						],
					},
				},
			},
		},
	};
}

function transaction(overrides: Record<string, unknown> = {}) {
	const fixture = eligibleStep();
	const tx = {
		$executeRaw: async () => 1,
		followUpStep: {
			findMany: async (args: { where: Record<string, unknown> }) =>
				"id" in args.where
					? [fixture.step]
					: [{ id: "step-1", planId: fixture.planId, status: "COMPLETED" }],
		},
		personProtection: { findMany: async () => [] },
		footballPlayer: { findMany: async () => [] },
		prospectPlayerProtection: { findMany: async () => [] },
		organizationProtection: { findMany: async () => [] },
		contactRouteConsent: { findMany: async () => [] },
		outboundDelivery: {
			findMany: async (args: { where: Record<string, unknown> }) =>
				"draftId" in args.where
					? [{ draftId: fixture.sourceDraftId, sentAt }]
					: [],
		},
		outreachSuppression: { findMany: async () => [] },
		suppressedContact: { findMany: async () => [] },
		suppressedDomain: { findMany: async () => [] },
		channelEngagementState: { findMany: async () => [] },
		relationshipColdTouchClaim: {
			findMany: async () => [
				{
					contactId: fixture.contactId,
					leadId: fixture.leadId,
					channel: "EMAIL",
					status: "CONSUMED",
				},
			],
		},
		followUpPlan: {
			groupBy: async () => [
				{ contactId: fixture.contactId, _count: { _all: 1 } },
			],
		},
		emailMessage: { findMany: async () => [] },
		contactRoute: {
			findMany: async () => [],
		},
		lead: { findMany: async () => [] },
		...overrides,
	};
	return tx as unknown as Prisma.TransactionClient;
}

describe("batched follow-up cohort preflight", () => {
	test("evaluates a production-sized candidate set in bounded principal transactions", async () => {
		const ids = Array.from({ length: 268 }, (_value, index) => `step-${index}`);
		let transactionCount = 0;
		const stepQuerySizes: number[] = [];
		const fixture = eligibleStep();
		const tx = transaction({
			followUpStep: {
				findMany: async (args: { where: Record<string, unknown> }) => {
					if ("id" in args.where) {
						const requestedIds = (args.where.id as { in: string[] }).in;
						stepQuerySizes.push(requestedIds.length);
						return requestedIds.map((id) => ({
							...fixture.step,
							id,
							plan: {
								...fixture.step.plan,
								id: `plan-${id}`,
								contactId: `contact-${id}`,
								leadId: `lead-${id}`,
							},
							draft: {
								...fixture.step.draft,
								recipientRoute: {
									...fixture.step.draft.recipientRoute,
									id: `route-${id}`,
									contactId: `contact-${id}`,
									normalizedValue: `${id}@example.test`,
									contact: {
										...fixture.step.draft.recipientRoute.contact,
										id: `contact-${id}`,
										companyId: null,
										company: null,
									},
								},
							},
						}));
					}
					return [];
				},
			},
		});
		const db = {
			$transaction: async <T>(
				run: (client: Prisma.TransactionClient) => Promise<T>,
			) => {
				transactionCount += 1;
				return run(tx);
			},
		} as unknown as Db;
		const results = await evaluateFollowUpCohortBatchWithPrincipal(
			db,
			{ userId: "user-1", kind: "user" },
			ids,
			now,
			50,
		);
		expect(transactionCount).toBe(6);
		expect(stepQuerySizes).toEqual([50, 50, 50, 50, 50, 18]);
		expect(results).toHaveLength(268);
		expect(
			results.every(
				(result) =>
					!result.eligible &&
					result.reason === "FOLLOW_UP_ORGANIZATION_UNRESOLVED",
			),
		).toBe(true);
	});

	test("admits a fully eligible FU1 from batched evidence", async () => {
		const result = await evaluateFollowUpCohortBatch(
			transaction(),
			["step-1"],
			now,
		);
		expect(result).toEqual([
			{
				id: "step-1",
				eligible: true,
				reason: null,
				canonicalDueAt: expect.any(Date),
			},
		]);
	});

	test("excludes person protection from batched evidence", async () => {
		const fixture = eligibleStep();
		const result = await evaluateFollowUpCohortBatch(
			transaction({
				personProtection: {
					findMany: async () => [{ contactId: fixture.contactId }],
				},
			}),
			["step-1"],
			now,
		);
		expect(result[0]).toMatchObject({
			eligible: false,
			reason: "PERSON_OWNER_PROTECTED",
		});
	});

	test("excludes route collisions within and outside the selected set", async () => {
		const fixture = eligibleStep();
		const result = await evaluateFollowUpCohortBatch(
			transaction({
				contactRoute: {
					findMany: async () => [
						{
							id: fixture.routeId,
							contactId: fixture.contactId,
							normalizedValue: "agent@example.test",
						},
						{
							id: "route-other",
							contactId: "contact-other",
							normalizedValue: "agent@example.test",
						},
					],
				},
			}),
			["step-1"],
			now,
		);
		expect(result[0]).toMatchObject({
			eligible: false,
			reason: "FOLLOW_UP_ROUTE_COLLISION",
		});
	});

	test.each([
		[
			"organization protection",
			"organizationProtection",
			{ findMany: async () => [{ companyId: "company-1" }] },
			"ORGANIZATION_OWNER_PROTECTED",
		],
		[
			"route do-not-contact",
			"contactRouteConsent",
			{ findMany: async () => [{ routeId: "route-1" }] },
			"ROUTE_DO_NOT_CONTACT",
		],
		[
			"cross-channel engagement",
			"channelEngagementState",
			{ findMany: async () => [{ contactId: "contact-1" }] },
			"ACTIVE_CROSS_CHANNEL_RELATIONSHIP",
		],
		[
			"unconsumed contact-once claim",
			"relationshipColdTouchClaim",
			{
				findMany: async () => [
					{
						contactId: "contact-1",
						leadId: "lead-1",
						channel: "EMAIL",
						status: "RESERVED",
					},
				],
			},
			"CONTACT_ONCE_STATE_UNRESOLVED",
		],
		[
			"post-outreach human reply",
			"emailMessage",
			{
				findMany: async () => [
					{
						sentAt: new Date("2026-09-29T08:00:00.000Z"),
						inboundIntent: "HUMAN_NEUTRAL",
						thread: { contactId: "contact-1" },
					},
				],
			},
			"POST_OUTREACH_INBOUND_REQUIRES_REVIEW",
		],
	] as Array<[string, string, Record<string, unknown>, string]>)(
		"blocks %s using the production reason",
		async (_label, delegate, value, reason) => {
			const result = await evaluateFollowUpCohortBatch(
				transaction({ [delegate]: value }),
				["step-1"],
				now,
			);
			expect(result[0]).toMatchObject({ eligible: false, reason });
		},
	);

	test("does not treat an autoresponder as a human reply", async () => {
		const result = await evaluateFollowUpCohortBatch(
			transaction({
				emailMessage: {
					findMany: async () => [
						{
							sentAt: new Date("2026-09-29T08:00:00.000Z"),
							inboundIntent: "AUTO_REPLY",
							thread: { contactId: "contact-1" },
						},
					],
				},
			}),
			["step-1"],
			now,
		);
		expect(result[0]).toMatchObject({ eligible: true, reason: null });
	});

	test("keeps a stored-due FU2 excluded while canonical 5+5 timing is future", async () => {
		const fixture = eligibleStep();
		const fu2 = { ...fixture.step, position: 1 };
		const result = await evaluateFollowUpCohortBatch(
			transaction({
				followUpStep: {
					findMany: async (args: { where: Record<string, unknown> }) =>
						"id" in args.where
							? [fu2]
							: [
									{
										id: "first-step",
										planId: fixture.planId,
										status: "COMPLETED",
									},
								],
				},
				outboundDelivery: {
					findMany: async (args: { where: Record<string, unknown> }) => {
						if ("draftId" in args.where)
							return [{ draftId: fixture.sourceDraftId, sentAt }];
						if ("idempotencyKey" in args.where)
							return [
								{
									idempotencyKey: "followup-delivery:first-step",
									status: "SENT",
									sentAt: new Date("2026-10-05T07:00:00.000Z"),
								},
							];
						return [];
					},
				},
			}),
			["step-1"],
			now,
		);
		expect(result[0]).toMatchObject({
			eligible: false,
			reason: "CANONICAL_FOLLOW_UP_NOT_DUE",
			canonicalDueAt: expect.any(Date),
		});
	});
});
