import { afterAll, describe, expect, it } from "bun:test";

const testDatabaseUrl = process.env.LINKEDIN_ACTION_QUEUE_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
	describe.skip("LinkedIn action queue database integration", () => {});
} else {
	process.env.DATABASE_URL = testDatabaseUrl;
	const { db } = await import("../src/client");
	const { LinkedInActionQueueService } = await import(
		"../../../apps/api/src/linkedin/linkedin-action-queue.service"
	);
	const { LinkedInChannelService } = await import(
		"../../../apps/api/src/linkedin/linkedin-channel.service"
	);
	const suffix = crypto.randomUUID();
	const actorId = `linkedin-action-queue-actor-${suffix}`;
	const contactId = `linkedin-action-queue-contact-${suffix}`;
	const routeId = `linkedin-action-queue-route-${suffix}`;
	const conversationId = `linkedin-action-queue-conversation-${suffix}`;
	const connectionContactId = `linkedin-action-queue-connection-contact-${suffix}`;
	const connectionRouteId = `linkedin-action-queue-connection-route-${suffix}`;
	const profileIdentifier = `linkedin-action-queue-profile-${suffix}`;
	const profileUrl = `https://www.linkedin.com/in/${profileIdentifier}/`;
	const connectionProfileIdentifier = `linkedin-action-queue-connection-profile-${suffix}`;
	const connectionProfileUrl = `https://www.linkedin.com/in/${connectionProfileIdentifier}/`;
	const accountKey = `linkedin-action-queue-account-${suffix}`;
	const service = new LinkedInActionQueueService(
		db,
		new LinkedInChannelService(db),
	);

	describe("LinkedIn action queue handoff", () => {
		it("auto-approves idempotent routine messages and does not enforce 20", async () => {
			await db.user.create({
				data: {
					id: actorId,
					name: "LinkedIn Queue Test",
					email: `${actorId}@example.invalid`,
				},
			});
			await db.contact.create({
				data: { id: contactId, firstName: "Queue", lastName: "Test" },
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
			await db.linkedInConversation.create({
				data: {
					id: conversationId,
					contactId,
					identityKey: profileIdentifier,
					profileUrl,
					normalizedProfileUrl: profileIdentifier,
					connectionState: "CONNECTED",
					consent: "ALLOWED",
				},
			});
			await db.contact.create({
				data: {
					id: connectionContactId,
					firstName: "Connection",
					lastName: "Test",
				},
			});
			await db.contactRoute.create({
				data: {
					id: connectionRouteId,
					contactId: connectionContactId,
					ownerUserId: actorId,
					type: "LINKEDIN",
					value: connectionProfileUrl,
					normalizedValue: connectionProfileIdentifier,
				},
			});

			const input = {
				action: "EXISTING_CONVERSATION_MESSAGE" as const,
				conversationId,
				idempotencyKey: `linkedin-action-queue:message:${suffix}`,
				body: "A routine qualification message without commercial terms.",
				coldOutreach: false,
				accountKey,
			};
			const legacyKey = `linkedin-action-queue:legacy:${suffix}`;
			await db.linkedInSendJob.create({
				data: {
					conversationId,
					action: "MESSAGE",
					quotaDay: new Date(),
					idempotencyKey: legacyKey,
				},
			});
			const legacy = await service.queueRoutineAction({
				...input,
				idempotencyKey: legacyKey,
			});
			expect(legacy.classification).toBe("ROUTINE_AUTONOMOUS");
			expect(
				await db.linkedInSendJob.findUniqueOrThrow({
					where: { id: legacy.jobId ?? "" },
					select: { approvedAt: true },
				}),
			).toMatchObject({ approvedAt: expect.any(Date) });
			const first = await service.queueRoutineAction(input);
			const second = await service.queueRoutineAction(input);
			expect(first.classification).toBe("ROUTINE_AUTONOMOUS");
			expect(first.approvedAt).toBeInstanceOf(Date);
			expect(second.jobId).toBe(first.jobId);
			const job = await db.linkedInSendJob.findUniqueOrThrow({
				where: { id: first.jobId ?? "" },
				select: { approvedAt: true, actionPayload: true },
			});
			expect(job.approvedAt).toBeInstanceOf(Date);
			expect(job.actionPayload).toMatchObject({
				atlasActionType: "EXISTING_CONVERSATION_MESSAGE",
			});
			expect(
				await db.linkedInSendJob.count({ where: { conversationId } }),
			).toBe(1);
			expect(
				await db.linkedInQuota.findFirst({
					where: { accountKey },
					orderBy: { createdAt: "desc" },
					select: { messageReserved: true, messageLimit: true },
				}),
			).toMatchObject({ messageReserved: 1, messageLimit: 0 });
			const connection = await service.queueRoutineAction({
				action: "CONNECTION_REQUEST",
				contactId: connectionContactId,
				routeId: connectionRouteId,
				profileUrl: connectionProfileUrl,
				profileIdentifier: connectionProfileIdentifier,
				idempotencyKey: `linkedin-action-queue:connection:${suffix}`,
				accountKey,
			});
			expect(connection.classification).toBe("ROUTINE_AUTONOMOUS");
			expect(connection.approvedAt).toBeInstanceOf(Date);
			const connectionJob =
				await db.linkedInConnectionRequestJob.findUniqueOrThrow({
					where: { id: connection.jobId ?? "" },
					select: { approvedAt: true },
				});
			expect(connectionJob.approvedAt).toBeInstanceOf(Date);
		});

		it("does not queue handoff, protected, or ambiguous actions", async () => {
			const withIhsan = await service.queueRoutineAction({
				action: "ROUTINE_REPLY",
				conversationId,
				idempotencyKey: `linkedin-action-queue:pricing:${suffix}`,
				body: "Our pricing is available in three packages.",
				coldOutreach: false,
			});
			expect(withIhsan).toMatchObject({
				classification: "WITH_IHSAN",
				jobId: null,
			});
			const ambiguous = await service.queueRoutineAction({
				action: "ROUTINE_REPLY",
				conversationId,
				idempotencyKey: `linkedin-action-queue:ambiguous:${suffix}`,
				body: "A routine reply.",
				context: { identityVerified: false },
				coldOutreach: false,
			});
			expect(ambiguous).toMatchObject({
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				jobId: null,
			});
			await db.personProtection.create({
				data: {
					contactId,
					reason: "Queue test protection",
					source: "MANUAL_IHSAN",
					protectedByUserId: actorId,
					idempotencyKey: `linkedin-action-queue:protection:${suffix}`,
				},
			});
			const protectedResult = await service.queueRoutineAction({
				action: "ROUTINE_REPLY",
				conversationId,
				idempotencyKey: `linkedin-action-queue:protected:${suffix}`,
				body: "A routine reply.",
				coldOutreach: false,
			});
			expect(protectedResult).toMatchObject({
				classification: "BLOCKED",
				reason: "PERSON_OWNER_PROTECTED",
				jobId: null,
			});
		});
	});

	afterAll(async () => {
		await db.linkedInConnectionRequestJob.deleteMany({
			where: { contactId: connectionContactId },
		});
		await db.relationshipColdTouchClaim.deleteMany({
			where: { contactId: connectionContactId },
		});
		await db.contactRoute.deleteMany({ where: { id: connectionRouteId } });
		await db.contact.deleteMany({ where: { id: connectionContactId } });
		await db.linkedInSendJob.deleteMany({ where: { conversationId } });
		await db.linkedInMessage.deleteMany({ where: { conversationId } });
		await db.personProtection.deleteMany({ where: { contactId } });
		await db.linkedInConversation.deleteMany({ where: { id: conversationId } });
		await db.contactRoute.deleteMany({ where: { id: routeId } });
		await db.contact.deleteMany({ where: { id: contactId } });
		await db.user.deleteMany({ where: { id: actorId } });
		await db.linkedInQuota.deleteMany({ where: { accountKey } });
		await db.$disconnect();
	});
}
