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
	const firstMessageContactId = `linkedin-action-queue-first-message-contact-${suffix}`;
	const firstMessageRouteId = `linkedin-action-queue-first-message-route-${suffix}`;
	const firstMessageConnectionJobId = `linkedin-action-queue-first-message-connection-job-${suffix}`;
	const firstMessageClaimKey = `linkedin-action-queue:first-connection:${suffix}`;
	const profileIdentifier = `linkedin-action-queue-profile-${suffix}`;
	const profileUrl = `https://www.linkedin.com/in/${profileIdentifier}/`;
	const connectionProfileIdentifier = `linkedin-action-queue-connection-profile-${suffix}`;
	const connectionProfileUrl = `https://www.linkedin.com/in/${connectionProfileIdentifier}/`;
	const firstMessageProfileIdentifier = `linkedin-action-queue-first-message-profile-${suffix}`;
	const firstMessageProfileUrl = `https://www.linkedin.com/in/${firstMessageProfileIdentifier}/`;
	const accountKey = `linkedin-action-queue-account-${suffix}`;
	const channelService = new LinkedInChannelService(db);
	const service = new LinkedInActionQueueService(db, channelService);

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
			await db.contact.create({
				data: {
					id: firstMessageContactId,
					firstName: "First",
					lastName: "Message",
				},
			});
			await db.contactRoute.create({
				data: {
					id: firstMessageRouteId,
					contactId: firstMessageContactId,
					ownerUserId: actorId,
					type: "LINKEDIN",
					value: firstMessageProfileUrl,
					normalizedValue: firstMessageProfileIdentifier,
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
					classification: "ACTION_REQUIRED",
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
				await db.linkedInSendJob.count({
					where: { conversationId, idempotencyKey: input.idempotencyKey },
				}),
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

		it("creates and reuses one conversation for a verified first message", async () => {
			await db.relationshipColdTouchClaim.create({
				data: {
					contactId: firstMessageContactId,
					channel: "LINKEDIN",
					status: "CONSUMED",
					idempotencyKey: firstMessageClaimKey,
					consumedAt: new Date(),
				},
			});
			await db.linkedInConnectionRequestJob.create({
				data: {
					id: firstMessageConnectionJobId,
					contactId: firstMessageContactId,
					routeId: firstMessageRouteId,
					profileUrl: firstMessageProfileUrl,
					profileIdentifier: firstMessageProfileIdentifier,
					status: "SUCCEEDED",
					idempotencyKey: firstMessageClaimKey,
					quotaDay: new Date(),
					actionPayload: { noNote: true, note: null },
				},
			});
			const baseInput = {
				action: "FIRST_MESSAGE_TO_CONNECTED_PERSON" as const,
				contactId: firstMessageContactId,
				routeId: firstMessageRouteId,
				profileUrl: firstMessageProfileUrl,
				profileIdentifier: firstMessageProfileIdentifier,
				body: "A relevant first message without commercial terms.",
				accountKey,
				context: {
					identityVerified: true,
					relationshipVerified: true,
					relationshipState: "CONNECTED" as const,
				},
			};
			const handoff = await service.queueRoutineAction({
				...baseInput,
				idempotencyKey: `linkedin-action-queue:first-handoff:${suffix}`,
				body: "Our pricing is available in three packages.",
			});
			expect(handoff).toMatchObject({
				classification: "WITH_IHSAN",
				jobId: null,
			});
			expect(
				await db.linkedInConversation.count({
					where: { identityKey: firstMessageProfileIdentifier },
				}),
			).toBe(0);
			const ambiguous = await service.queueRoutineAction({
				...baseInput,
				idempotencyKey: `linkedin-action-queue:first-ambiguous:${suffix}`,
				context: {
					identityVerified: true,
					relationshipVerified: true,
					relationshipState: "UNKNOWN",
				},
			});
			expect(ambiguous).toMatchObject({
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				jobId: null,
			});
			const [first, second] = await Promise.all([
				service.queueRoutineAction({
					...baseInput,
					idempotencyKey: `linkedin-action-queue:first:${suffix}`,
				}),
				service.queueRoutineAction({
					...baseInput,
					idempotencyKey: `linkedin-action-queue:first:${suffix}`,
				}),
			]);
			expect(first.classification).toBe("ROUTINE_AUTONOMOUS");
			expect(second.jobId).toBe(first.jobId);
			expect(first.approvedAt).toBeInstanceOf(Date);
			const conversation = await db.linkedInConversation.findUniqueOrThrow({
				where: { identityKey: firstMessageProfileIdentifier },
				select: {
					id: true,
					connectionState: true,
					classification: true,
					externalConversationKey: true,
				},
			});
			expect(conversation.connectionState).toBe("CONNECTED");
			expect(conversation.classification).toBe("ACTION_REQUIRED");
			expect(conversation.externalConversationKey).toBeNull();
			expect(
				await db.relationshipColdTouchClaim.findUniqueOrThrow({
					where: { contactId: firstMessageContactId },
					select: { status: true, idempotencyKey: true },
				}),
			).toMatchObject({
				status: "CLAIMED",
				idempotencyKey: `linkedin-action-queue:first:${suffix}`,
			});
			expect(
				await db.linkedInConversation.count({
					where: { contactId: firstMessageContactId },
				}),
			).toBe(1);
			expect(
				await db.linkedInSendJob.count({
					where: { conversationId: conversation.id },
				}),
			).toBe(1);
			const leasedJobId = first.jobId;
			if (!leasedJobId) throw new Error("CLEANUP_JOB_NOT_CREATED");
			await db.linkedInSendJob.update({
				where: { id: leasedJobId },
				data: {
					status: "LEASED",
					leaseOwner: "linkedin-action-queue-cleanup-worker",
					leasedUntil: new Date(Date.now() + 60_000),
					attemptCount: 1,
				},
			});
			const attempt = await channelService.prepareMessageExecution(
				leasedJobId,
				"linkedin-action-queue-cleanup-worker",
			);
			if ("blockedReason" in attempt)
				throw new Error(`CLEANUP_PREPARE_BLOCKED:${attempt.blockedReason}`);
			await channelService.recordAttempt({
				jobId: leasedJobId,
				workerId: "linkedin-action-queue-cleanup-worker",
				attemptNumber: attempt.attempt.attemptNumber,
				status: "FAILED",
				errorCode: "MESSAGE_EDITOR_UNAVAILABLE",
			});
			const cleaned = await db.linkedInSendJob.findUniqueOrThrow({
				where: { id: leasedJobId },
				include: { message: true },
			});
			expect(cleaned.status).toBe("FAILED");
			expect(cleaned.retryAt).toBeNull();
			expect(cleaned.message?.status).toBe("FAILED");
			expect(
				await db.relationshipColdTouchClaim.findUniqueOrThrow({
					where: { contactId: firstMessageContactId },
					select: { status: true },
				}),
			).toMatchObject({ status: "RELEASED" });
			expect(
				await db.activity.count({
					where: { linkedinMessageId: cleaned.messageId ?? "" },
				}),
			).toBe(0);
			expect(
				await channelService.recoverUnsentMessage(
					leasedJobId,
					"MESSAGE_EDITOR_UNAVAILABLE",
				),
			).toMatchObject({ status: "ALREADY_RELEASED" });
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
		const firstMessageConversation = await db.linkedInConversation.findUnique({
			where: { identityKey: firstMessageProfileIdentifier },
			select: { id: true },
		});
		if (firstMessageConversation) {
			await db.linkedInSendJob.deleteMany({
				where: { conversationId: firstMessageConversation.id },
			});
			await db.linkedInMessage.deleteMany({
				where: { conversationId: firstMessageConversation.id },
			});
			await db.linkedInConversation.delete({
				where: { id: firstMessageConversation.id },
			});
		}
		await db.linkedInConnectionRequestJob.deleteMany({
			where: { id: firstMessageConnectionJobId },
		});
		await db.relationshipColdTouchClaim.deleteMany({
			where: { contactId: firstMessageContactId },
		});
		await db.contactRoute.deleteMany({ where: { id: firstMessageRouteId } });
		await db.contact.deleteMany({ where: { id: firstMessageContactId } });
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
