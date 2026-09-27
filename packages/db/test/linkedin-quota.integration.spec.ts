import { afterAll, describe, expect, it } from "bun:test";

const testDatabaseUrl = process.env.LINKEDIN_ACTION_QUEUE_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
	describe.skip("LinkedIn quota database integration", () => {});
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
	const actorId = `linkedin-quota-actor-${suffix}`;
	const contactId = `linkedin-quota-contact-${suffix}`;
	const routeId = `linkedin-quota-route-${suffix}`;
	const conversationId = `linkedin-quota-conversation-${suffix}`;
	const profileIdentifier = `linkedin-quota-profile-${suffix}`;
	const profileUrl = `https://www.linkedin.com/in/${profileIdentifier}/`;
	const accountKey = `linkedin-quota-account-${suffix}`;
	const channelService = new LinkedInChannelService(db);
	const service = new LinkedInActionQueueService(db, channelService);

	describe("LinkedIn quota lifecycle", () => {
		it("rolls forward account quota and accounts for exhaustion, release, and send", async () => {
			await db.user.create({
				data: {
					id: actorId,
					name: "LinkedIn Quota Test",
					email: `${actorId}@example.invalid`,
				},
			});
			await db.contact.create({
				data: { id: contactId, firstName: "Quota", lastName: "Test" },
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
					status: "ACTIVE",
					classification: "ACTION_REQUIRED",
					consent: "ALLOWED",
				},
			});
			const previousQuotaDay = new Date();
			previousQuotaDay.setUTCHours(0, 0, 0, 0);
			previousQuotaDay.setUTCDate(previousQuotaDay.getUTCDate() - 1);
			await db.linkedInQuota.create({
				data: {
					day: previousQuotaDay,
					accountKey,
					messageLimit: 3,
					connectionLimit: 4,
				},
			});

			const input = {
				action: "EXISTING_CONVERSATION_MESSAGE" as const,
				conversationId,
				body: "A legitimate quota lifecycle message.",
				coldOutreach: false,
				accountKey,
			};
			const queue = (idempotencyKey: string) =>
				service.queueRoutineAction({ ...input, idempotencyKey });

			const first = await queue(`linkedin-quota:first:${suffix}`);
			expect(first.classification).toBe("ROUTINE_AUTONOMOUS");
			expect(
				await db.linkedInQuota.findUniqueOrThrow({
					where: { day_accountKey: { day: new Date(), accountKey } },
					select: {
						messageReserved: true,
						messageSent: true,
						messageLimit: true,
					},
				}),
			).toEqual({ messageReserved: 1, messageSent: 0, messageLimit: 3 });
			await db.linkedInQuota.update({
				where: { day_accountKey: { day: new Date(), accountKey } },
				data: { messageSent: 2 },
			});
			let exhausted = false;
			try {
				await queue(`linkedin-quota:exhausted:${suffix}`);
			} catch (error) {
				exhausted = true;
				expect((error as Error).message).toContain(
					"LinkedIn channel quota is exhausted.",
				);
			}
			expect(exhausted).toBe(true);
			const afterExhaustion = await db.linkedInQuota.findUniqueOrThrow({
				where: { day_accountKey: { day: new Date(), accountKey } },
				select: {
					messageReserved: true,
					messageSent: true,
					messageLimit: true,
				},
			});
			expect(afterExhaustion).toEqual({
				messageReserved: 1,
				messageSent: 2,
				messageLimit: 3,
			});

			const workerId = `linkedin-quota-worker-${suffix}`;
			const leased = (await channelService.claimNextJob(workerId)) as Array<{
				id: string;
			}>;
			expect(leased).toHaveLength(1);
			const failedAttempt = await channelService.beginAttempt(
				leased[0]?.id ?? "",
				workerId,
			);
			await channelService.recordAttempt({
				jobId: leased[0]?.id ?? "",
				workerId,
				attemptNumber: failedAttempt.attemptNumber,
				status: "FAILED",
				errorCode: "WRONG_CONVERSATION",
			});
			expect(
				await db.linkedInQuota.findUniqueOrThrow({
					where: { day_accountKey: { day: new Date(), accountKey } },
					select: { messageReserved: true, messageSent: true },
				}),
			).toEqual({ messageReserved: 0, messageSent: 2 });

			const released = await queue(`linkedin-quota:after-release:${suffix}`);
			expect(released.classification).toBe("ROUTINE_AUTONOMOUS");

			const successWorkerId = `linkedin-quota-success-worker-${suffix}`;
			const successfulLease = (await channelService.claimNextJob(
				successWorkerId,
			)) as Array<{ id: string }>;
			const successfulAttempt = await channelService.beginAttempt(
				successfulLease[0]?.id ?? "",
				successWorkerId,
			);
			await channelService.recordAttempt({
				jobId: successfulLease[0]?.id ?? "",
				workerId: successWorkerId,
				attemptNumber: successfulAttempt.attemptNumber,
				status: "SUCCEEDED",
				verifiedProfileUrl: profileUrl,
				verifiedProfileIdentifier: profileIdentifier,
				externalMessageKey: `linkedin-quota-message-${suffix}`,
				externalConversationKey: null,
				browserProof: { test: true },
			});
			expect(
				await db.linkedInQuota.findUniqueOrThrow({
					where: { day_accountKey: { day: new Date(), accountKey } },
					select: { messageReserved: true, messageSent: true },
				}),
			).toEqual({ messageReserved: 0, messageSent: 3 });
			expect(
				await db.activity.count({
					where: { contactId, linkedinMessageId: { not: null } },
				}),
			).toBe(1);
		});
	});

	afterAll(async () => {
		await db.activity.deleteMany({ where: { contactId } });
		await db.linkedInSendJob.deleteMany({ where: { accountKey } });
		await db.linkedInMessage.deleteMany({ where: { conversationId } });
		await db.channelEngagementState.deleteMany({ where: { contactId } });
		await db.linkedInConversation.deleteMany({ where: { id: conversationId } });
		await db.contactRoute.deleteMany({ where: { id: routeId } });
		await db.contact.deleteMany({ where: { id: contactId } });
		await db.user.deleteMany({ where: { id: actorId } });
		await db.linkedInQuota.deleteMany({ where: { accountKey } });
		await db.$disconnect();
	});
}
