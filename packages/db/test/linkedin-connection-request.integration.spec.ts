import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const testDatabaseUrl =
	process.env.LINKEDIN_CONNECTION_REQUEST_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
	describe.skip("LinkedIn connection request database integration", () => {});
} else {
	process.env.DATABASE_URL = testDatabaseUrl;
	const { db } = await import("../src/client");
	const { LinkedInChannelService } = await import(
		"../../../apps/api/src/linkedin/linkedin-channel.service"
	);

	const suffix = crypto.randomUUID();
	const actorId = `linkedin-connection-actor-${suffix}`;
	const service = new LinkedInChannelService(db);

	async function createTarget(label: string) {
		const contactId = `linkedin-connection-contact-${label}-${suffix}`;
		const routeId = `linkedin-connection-route-${label}-${suffix}`;
		const profileIdentifier = `linkedin-profile-${label}-${suffix}`;
		const profileUrl = `https://www.linkedin.com/in/${profileIdentifier}/`;
		await db.contact.create({
			data: { id: contactId, firstName: label, lastName: "Test" },
		});
		await db.contactRoute.create({
			data: {
				id: routeId,
				contactId,
				ownerUserId: actorId,
				type: "LINKEDIN",
				value: profileUrl,
				normalizedValue: profileIdentifier,
			},
		});
		return { contactId, routeId, profileIdentifier, profileUrl };
	}

	async function queue(
		target: Awaited<ReturnType<typeof createTarget>>,
		key: string,
	) {
		return service.queueConnectionRequest({
			...target,
			idempotencyKey: `linkedin-connection-request:${key}:${suffix}`,
			approvedAt: new Date(),
			accountKey: `linkedin-test-${key}-${suffix}`,
		});
	}

	async function leaseExact(jobId: string, workerId: string) {
		await db.$executeRawUnsafe(
			`UPDATE "linkedinConnectionRequestJob" SET "status" = 'LEASED', "leaseOwner" = $1, "leasedUntil" = NOW() + INTERVAL '60 seconds', "attemptCount" = "attemptCount" + 1, "updatedAt" = NOW() WHERE "id" = $2`,
			workerId,
			jobId,
		);
	}

	describe("LinkedIn connection request lifecycle", () => {
		beforeAll(async () => {
			await db.user.create({
				data: {
					id: actorId,
					name: "LinkedIn Connection Test Actor",
					email: `${actorId}@example.invalid`,
				},
			});
			await db.user.upsert({
				where: { id: "atlas-operator" },
				create: {
					id: "atlas-operator",
					name: "Atlas Operator",
					email: "atlas-operator@example.invalid",
				},
				update: {},
			});
		});

		it("queues without a conversation and records one confirmed projection", async () => {
			const target = await createTarget("success");
			const queued = await queue(target, "success");
			const claimed = (
				await service.claimNextConnectionRequestJob(
					"worker-success",
					`linkedin-test-success-${suffix}`,
				)
			)[0] as {
				id: string;
			};
			expect(claimed.id).toBe(queued.id);
			const begun = await service.beginConnectionRequestAttempt(
				queued.id,
				"worker-success",
			);
			const result = await service.recordConnectionRequestAttempt({
				jobId: queued.id,
				workerId: "worker-success",
				attemptNumber: begun.attempt.attemptNumber,
				status: "SUCCEEDED",
				externalRequestKey: `external-success-${suffix}`,
				verifiedProfileUrl: target.profileUrl,
				verifiedProfileIdentifier: target.profileIdentifier,
				browserProof: {
					profileUrl: target.profileUrl,
					profileIdentifier: target.profileIdentifier,
				},
			});
			expect(result.status).toBe("SUCCEEDED");
			expect(
				await db.linkedInConversation.count({
					where: { contactId: target.contactId },
				}),
			).toBe(0);
			expect(
				await db.activity.count({
					where: { linkedinConnectionRequestJobId: queued.id },
				}),
			).toBe(1);
			expect(
				await db.relationshipColdTouchClaim.findUnique({
					where: { contactId: target.contactId },
					select: { status: true },
				}),
			).toEqual({ status: "CONSUMED" });
		});

		it("is idempotent and creates one shared claim", async () => {
			const target = await createTarget("idempotent");
			const first = await queue(target, "idempotent");
			const second = await queue(target, "idempotent");
			expect(second.id).toBe(first.id);
			expect(
				await db.relationshipColdTouchClaim.count({
					where: { contactId: target.contactId },
				}),
			).toBe(1);
			expect(
				await db.linkedInConnectionRequestJob.count({
					where: { contactId: target.contactId },
				}),
			).toBe(1);
		});

		it("allows only one concurrent cross-channel first touch", async () => {
			const target = await createTarget("race");
			const results = await Promise.allSettled([
				queue(target, "race-a"),
				queue(target, "race-b"),
			]);
			expect(
				results.filter((result) => result.status === "fulfilled"),
			).toHaveLength(1);
			expect(
				results.filter((result) => result.status === "rejected"),
			).toHaveLength(1);
			expect(
				await db.relationshipColdTouchClaim.count({
					where: { contactId: target.contactId },
				}),
			).toBe(1);
		});

		it("releases the claim and reservation when execution is skipped", async () => {
			const target = await createTarget("blocked");
			const queued = await queue(target, "blocked");
			await leaseExact(queued.id, "worker-blocked");
			const begun = await service.beginConnectionRequestAttempt(
				queued.id,
				"worker-blocked",
			);
			const result = await service.recordConnectionRequestAttempt({
				jobId: queued.id,
				workerId: "worker-blocked",
				attemptNumber: begun.attempt.attemptNumber,
				status: "BLOCKED",
				errorCode: "IDENTITY_MISMATCH",
			});
			expect(result.status).toBe("CANCELLED");
			expect(
				await db.relationshipColdTouchClaim.findUnique({
					where: { contactId: target.contactId },
					select: { status: true },
				}),
			).toEqual({ status: "RELEASED" });
		});

		it("retains the claim for an ambiguous browser outcome", async () => {
			const target = await createTarget("ambiguous");
			const queued = await queue(target, "ambiguous");
			await leaseExact(queued.id, "worker-ambiguous");
			const begun = await service.beginConnectionRequestAttempt(
				queued.id,
				"worker-ambiguous",
			);
			const result = await service.recordConnectionRequestAttempt({
				jobId: queued.id,
				workerId: "worker-ambiguous",
				attemptNumber: begun.attempt.attemptNumber,
				status: "AMBIGUOUS",
				errorCode: "SEND_STATE_UNCLEAR",
				browserProof: { visibleButton: "unknown" },
			});
			expect(result.status).toBe("WAITING_REVIEW");
			expect(
				await db.relationshipColdTouchClaim.findUnique({
					where: { contactId: target.contactId },
					select: { status: true },
				}),
			).toEqual({ status: "CLAIMED" });
		});

		it("keeps message actions conversation-bound", async () => {
			const target = await createTarget("message");
			let messageRejected = false;
			try {
				await service.queueAction({
					conversationId: "missing-conversation",
					action: "MESSAGE",
					idempotencyKey: `linkedin-message:${suffix}`,
					body: "Hello",
					approvedAt: new Date(),
				});
			} catch {
				messageRejected = true;
			}
			expect(messageRejected).toBe(true);
			const connectionJob = await queue(
				target,
				"message-connection-separation",
			);
			expect(connectionJob).not.toHaveProperty("conversationId");
		});

		it("blocks a person-protected target before creating a job", async () => {
			const target = await createTarget("protected");
			await db.personProtection.create({
				data: {
					contactId: target.contactId,
					reason: "Manual owner protection",
					source: "MANUAL_IHSAN",
					protectedByUserId: actorId,
					idempotencyKey: `linkedin-person-protection:${suffix}`,
				},
			});
			let blocked = false;
			try {
				await queue(target, "protected");
			} catch {
				blocked = true;
			}
			expect(blocked).toBe(true);
			expect(
				await db.linkedInConnectionRequestJob.count({
					where: { contactId: target.contactId },
				}),
			).toBe(0);
		});
	});

	afterAll(async () => {
		await db.$disconnect();
	});
}
