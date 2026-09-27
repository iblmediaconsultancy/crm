const testDatabaseUrl = process.env.LINKEDIN_ACTION_QUEUE_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
	describe.skip("LinkedIn history guard database integration", () => {});
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
	const actorId = `linkedin-history-guard-actor-${suffix}`;
	const historicalContactId = `linkedin-history-guard-contact-${suffix}`;
	const historicalRouteId = `linkedin-history-guard-route-${suffix}`;
	const untouchedContactId = `linkedin-history-guard-untouched-${suffix}`;
	const untouchedRouteId = `linkedin-history-guard-untouched-route-${suffix}`;
	const executionContactId = `linkedin-history-guard-execution-${suffix}`;
	const executionRouteId = `linkedin-history-guard-execution-route-${suffix}`;
	const executionConversationId = `linkedin-history-guard-execution-conversation-${suffix}`;
	const executionMessageId = `linkedin-history-guard-execution-message-${suffix}`;
	const executionJobId = `linkedin-history-guard-execution-job-${suffix}`;
	const historicalProfile = `linkedin-history-guard-${suffix}`;
	const untouchedProfile = `linkedin-history-guard-untouched-${suffix}`;
	const executionProfile = `linkedin-history-guard-execution-${suffix}`;
	const accountKey = `linkedin-history-guard-account-${suffix}`;
	const channelService = new LinkedInChannelService(db);
	const service = new LinkedInActionQueueService(db, channelService);

	describe("LinkedIn historical conversation guard", () => {
		it("fails closed when historical Activities prove prior substantive outreach", async () => {
			await db.user.create({
				data: {
					id: actorId,
					name: "LinkedIn History Guard",
					email: `${actorId}@example.invalid`,
				},
			});
			await db.contact.create({
				data: {
					id: historicalContactId,
					firstName: "Historical",
					lastName: "Contact",
				},
			});
			await db.contactRoute.create({
				data: {
					id: historicalRouteId,
					contactId: historicalContactId,
					ownerUserId: actorId,
					type: "LINKEDIN",
					value: `https://www.linkedin.com/in/${historicalProfile}/`,
					normalizedValue: historicalProfile,
				},
			});
			await db.activity.create({
				data: {
					type: "NOTE",
					subject: "LinkedIn outbound message · verified",
					body: "Prior LinkedIn outreach",
					occurredAt: new Date("2026-09-18T12:00:00.000Z"),
					contactId: historicalContactId,
					createdById: actorId,
					meta: {
						channel: "LINKEDIN",
						direction: "OUTBOUND",
						historical: true,
					},
				},
			});
			const result = await service.queueRoutineAction({
				action: "FIRST_MESSAGE_TO_CONNECTED_PERSON",
				contactId: historicalContactId,
				routeId: historicalRouteId,
				profileUrl: `https://www.linkedin.com/in/${historicalProfile}/`,
				profileIdentifier: historicalProfile,
				body: "A new message",
				idempotencyKey: `linkedin-history-guard:historical:${suffix}`,
				coldOutreach: false,
				accountKey,
				messageLimit: 2,
				context: {
					identityVerified: true,
					relationshipVerified: true,
					relationshipState: "CONNECTED",
				},
			});
			expect(result).toMatchObject({
				classification: "AMBIGUOUS_REVIEW_REQUIRED",
				reason: "LINKEDIN_HISTORY_REQUIRES_RECONCILIATION",
				jobId: null,
			});
		});

		it("keeps an untouched connected prospect queueable", async () => {
			await db.contact.create({
				data: {
					id: untouchedContactId,
					firstName: "Untouched",
					lastName: "Contact",
				},
			});
			await db.contactRoute.create({
				data: {
					id: untouchedRouteId,
					contactId: untouchedContactId,
					ownerUserId: actorId,
					type: "LINKEDIN",
					value: `https://www.linkedin.com/in/${untouchedProfile}/`,
					normalizedValue: untouchedProfile,
				},
			});
			const result = await service.queueRoutineAction({
				action: "FIRST_MESSAGE_TO_CONNECTED_PERSON",
				contactId: untouchedContactId,
				routeId: untouchedRouteId,
				profileUrl: `https://www.linkedin.com/in/${untouchedProfile}/`,
				profileIdentifier: untouchedProfile,
				body: "A legitimate first message",
				idempotencyKey: `linkedin-history-guard:untouched:${suffix}`,
				coldOutreach: false,
				accountKey,
				messageLimit: 2,
				context: {
					identityVerified: true,
					relationshipVerified: true,
					relationshipState: "CONNECTED",
				},
			});
			expect(result.classification).toBe("ROUTINE_AUTONOMOUS");
			if (!result.jobId) throw new Error("EXPECTED_JOB");
			const untouchedJob = await db.linkedInSendJob.findUniqueOrThrow({
				where: { id: result.jobId },
				select: { conversationId: true },
			});
			await db.linkedInConversation.update({
				where: { id: untouchedJob.conversationId },
				data: { status: "WAITING_ON_PROSPECT" },
			});
			const waitingResult = await service.queueRoutineAction({
				action: "EXISTING_CONVERSATION_MESSAGE",
				conversationId: untouchedJob.conversationId,
				body: "An unsolicited follow-up",
				idempotencyKey: `linkedin-history-guard:waiting:${suffix}`,
				accountKey,
				messageLimit: 2,
				context: {
					identityVerified: true,
					relationshipVerified: true,
					relationshipState: "CONNECTED",
				},
			});
			expect(waitingResult).toMatchObject({
				classification: "BLOCKED",
				reason: "LINKEDIN_CONVERSATION_WAITING_ON_PROSPECT",
				jobId: null,
			});
		});

		it("blocks a leased first-message job when historical CRM evidence appears before execution", async () => {
			await db.contact.create({
				data: {
					id: executionContactId,
					firstName: "Execution",
					lastName: "Guard",
				},
			});
			await db.contactRoute.create({
				data: {
					id: executionRouteId,
					contactId: executionContactId,
					ownerUserId: actorId,
					type: "LINKEDIN",
					value: `https://www.linkedin.com/in/${executionProfile}/`,
					normalizedValue: executionProfile,
				},
			});
			await db.linkedInConversation.create({
				data: {
					id: executionConversationId,
					contactId: executionContactId,
					identityKey: executionProfile,
					profileUrl: `https://www.linkedin.com/in/${executionProfile}/`,
					normalizedProfileUrl: executionProfile,
					connectionState: "CONNECTED",
					classification: "ACTION_REQUIRED",
				},
			});
			await db.linkedInMessage.create({
				data: {
					id: executionMessageId,
					conversationId: executionConversationId,
					direction: "OUTBOUND",
					status: "QUEUED",
					provenance: "MANUAL",
					body: "Pending message",
					sourceKey: `linkedin-history-guard:execution:source:${suffix}`,
					idempotencyKey: `linkedin-history-guard:execution:message:${suffix}`,
				},
			});
			await db.linkedInSendJob.create({
				data: {
					id: executionJobId,
					conversationId: executionConversationId,
					messageId: executionMessageId,
					action: "MESSAGE",
					coldOutreach: false,
					accountKey,
					quotaDay: new Date(),
					status: "LEASED",
					leaseOwner: "history-guard-worker",
					leasedUntil: new Date(Date.now() + 60_000),
					attemptCount: 1,
					approvedAt: new Date(),
					idempotencyKey: `linkedin-history-guard:execution:job:${suffix}`,
					actionPayload: {
						atlasActionType: "FIRST_MESSAGE_TO_CONNECTED_PERSON",
					},
				},
			});
			await db.activity.create({
				data: {
					type: "NOTE",
					subject: "LinkedIn inbound message · verified",
					body: "New inbound appeared before execution",
					contactId: executionContactId,
					createdById: actorId,
					meta: { channel: "LINKEDIN", direction: "INBOUND", historical: true },
				},
			});
			const result = await channelService.prepareMessageExecution(
				executionJobId,
				"history-guard-worker",
			);
			expect(result).toEqual({
				blockedReason: "LINKEDIN_HISTORICAL_CONVERSATION_DETECTED",
			});
		});
	});

	afterAll(async () => {
		await db.linkedInSendJob.deleteMany({ where: { accountKey } });
		await db.linkedInMessage.deleteMany({ where: { id: executionMessageId } });
		await db.linkedInConversation.deleteMany({
			where: { id: executionConversationId },
		});
		await db.linkedInMessage.deleteMany({
			where: { conversation: { contactId: untouchedContactId } },
		});
		await db.linkedInConversation.deleteMany({
			where: { contactId: untouchedContactId },
		});
		await db.channelEngagementState.deleteMany({
			where: {
				contactId: {
					in: [historicalContactId, untouchedContactId, executionContactId],
				},
			},
		});
		await db.activity.deleteMany({
			where: {
				contactId: {
					in: [historicalContactId, untouchedContactId, executionContactId],
				},
			},
		});
		await db.contactRoute.deleteMany({
			where: {
				id: { in: [historicalRouteId, untouchedRouteId, executionRouteId] },
			},
		});
		await db.contact.deleteMany({
			where: {
				id: {
					in: [historicalContactId, untouchedContactId, executionContactId],
				},
			},
		});
		await db.user.deleteMany({ where: { id: actorId } });
		await db.linkedInQuota.deleteMany({ where: { accountKey } });
		await db.$disconnect();
	});
}
