import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const testDatabaseUrl = process.env.LINKEDIN_MANUAL_ACTION_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
	describe.skip("LinkedIn manual action database integration", () => {});
} else {
	process.env.DATABASE_URL = testDatabaseUrl;
	const { db } = await import("../src/client");
	const { LinkedInActionQueueService } = await import(
		"../../../apps/api/src/linkedin/linkedin-action-queue.service"
	);
	const { LinkedInChannelService } = await import(
		"../../../apps/api/src/linkedin/linkedin-channel.service"
	);
	const { LinkedInManualService } = await import(
		"../../../apps/api/src/linkedin/linkedin-manual.service"
	);
	const suffix = crypto.randomUUID();
	const userId = `linkedin-manual-user-${suffix}`;
	const contactId = `linkedin-manual-contact-${suffix}`;
	const routeId = `linkedin-manual-route-${suffix}`;
	const profileIdentifier = `linkedin-manual-profile-${suffix}`;
	const profileUrl = `https://www.linkedin.com/in/${profileIdentifier}/`;
	const channel = new LinkedInChannelService(db);
	const queue = new LinkedInActionQueueService(db, channel);
	const manual = new LinkedInManualService(db, queue);

	describe("LinkedIn manual action persistence", () => {
		beforeAll(async () => {
			await db.appSetting.upsert({
				where: { id: "app" },
				create: { id: "app", atlasLinkedInExecutionMode: "MANUAL" },
				update: { atlasLinkedInExecutionMode: "MANUAL" },
			});
			await db.user.create({
				data: {
					id: userId,
					name: "Manual LinkedIn Test",
					email: `${userId}@example.invalid`,
				},
			});
			await db.contact.create({
				data: { id: contactId, firstName: "Manual", lastName: "Target" },
			});
			await db.contactRoute.create({
				data: {
					id: routeId,
					contactId,
					ownerUserId: userId,
					type: "LINKEDIN",
					value: profileUrl,
					normalizedValue: profileIdentifier,
				},
			});
		});

		afterAll(async () => {
			await db.$disconnect();
		});

		it("records no-note requests without a fake conversation or message, then allows one first substantive message", async () => {
			await manual.reconcileRelationship(userId, {
				contactId,
				routeId,
				profileUrl,
				profileIdentifier,
				state: "NOT_CONNECTED",
				observedAt: new Date().toISOString(),
			});
			const autonomousPath = await queue.queueRoutineAction({
				action: "CONNECTION_REQUEST",
				contactId,
				routeId,
				profileUrl,
				profileIdentifier,
				idempotencyKey: `manual-mode-block-${suffix}`,
			});
			expect(autonomousPath).toMatchObject({
				classification: "BLOCKED",
				reason: "LINKEDIN_MANUAL_MODE_ACTIVE",
				jobId: null,
			});
			expect(
				await db.linkedInConnectionRequestJob.count({
					where: { idempotencyKey: `manual-mode-block-${suffix}` },
				}),
			).toBe(0);
			const request = await manual.prepare(userId, {
				contactId,
				routeId,
				type: "CONNECTION_REQUEST",
				whyNow: "A verified agency role makes a relevant introduction timely.",
				idempotencyKey: `manual-connection-${suffix}`,
			});
			expect(
				await db.linkedInSendJob.count({
					where: { idempotencyKey: `manual-connection-${suffix}` },
				}),
			).toBe(0);
			expect(
				await db.linkedInConnectionRequestJob.count({
					where: { idempotencyKey: `manual-connection-${suffix}` },
				}),
			).toBe(0);
			const requestResult = await manual.complete(userId, { id: request.id });
			const duplicateRequestResult = await manual.complete(userId, {
				id: request.id,
			});
			expect(requestResult).toEqual(duplicateRequestResult);
			expect(requestResult.messageId).toBeNull();
			expect(
				await db.linkedInConversation.count({ where: { contactId } }),
			).toBe(0);
			expect(
				await db.linkedInMessage.count({
					where: { manualActionId: request.id },
				}),
			).toBe(0);
			expect(
				await db.activity.count({
					where: { linkedinManualActionId: request.id },
				}),
			).toBe(1);
			expect(
				await db.relationshipColdTouchClaim.findUnique({
					where: { contactId },
					select: { status: true },
				}),
			).toMatchObject({ status: "CONSUMED" });

			await manual.reconcileRelationship(userId, {
				contactId,
				routeId,
				profileUrl,
				profileIdentifier,
				state: "CONNECTED",
				observedAt: new Date().toISOString(),
			});
			const firstMessage = await manual.prepare(userId, {
				contactId,
				routeId,
				type: "FIRST_MESSAGE",
				body: "I saw your work with the club and wanted to ask which players you represent.",
				whyNow:
					"The no-note invitation was accepted and this is the first real message.",
				idempotencyKey: `manual-first-message-${suffix}`,
			});
			const messageResult = await manual.complete(userId, {
				id: firstMessage.id,
			});
			expect(messageResult.messageId).toBeTruthy();
			expect(messageResult.activityId).toBeTruthy();
			expect(
				await db.linkedInMessage.count({
					where: { manualActionId: firstMessage.id },
				}),
			).toBe(1);
			expect(
				await db.activity.count({
					where: { linkedinManualActionId: firstMessage.id },
				}),
			).toBe(1);
			expect(
				await db.linkedInSendJob.count({
					where: { idempotencyKey: `manual-first-message-${suffix}` },
				}),
			).toBe(0);
			await expect(
				manual.prepare(userId, {
					contactId,
					routeId,
					type: "FIRST_MESSAGE",
					body: "A duplicate first message.",
					whyNow:
						"This should fail because a substantive message is already stored.",
					idempotencyKey: `manual-duplicate-first-message-${suffix}`,
				}),
			).rejects.toThrow();
		});

		it("releases a claimed first-touch reservation when a prepared action is cancelled", async () => {
			const newContactId = `${contactId}-cancel`;
			const newRouteId = `${routeId}-cancel`;
			const newProfileIdentifier = `${profileIdentifier}-cancel`;
			const newProfileUrl = `https://www.linkedin.com/in/${newProfileIdentifier}/`;
			await db.contact.create({
				data: { id: newContactId, firstName: "Cancel", lastName: "Target" },
			});
			await db.contactRoute.create({
				data: {
					id: newRouteId,
					contactId: newContactId,
					ownerUserId: userId,
					type: "LINKEDIN",
					value: newProfileUrl,
					normalizedValue: newProfileIdentifier,
				},
			});
			await manual.reconcileRelationship(userId, {
				contactId: newContactId,
				routeId: newRouteId,
				profileUrl: newProfileUrl,
				profileIdentifier: newProfileIdentifier,
				state: "NOT_CONNECTED",
				observedAt: new Date().toISOString(),
			});
			const action = await manual.prepare(userId, {
				contactId: newContactId,
				routeId: newRouteId,
				type: "CONNECTION_REQUEST",
				whyNow: "Verified decision-maker with relevant roster access.",
				idempotencyKey: `manual-cancel-${suffix}`,
			});
			await manual.cancel(userId, action.id);
			expect(
				await db.relationshipColdTouchClaim.findUnique({
					where: { contactId: newContactId },
					select: { status: true },
				}),
			).toMatchObject({ status: "RELEASED" });
			expect(
				await db.linkedInConnectionRequestJob.count({
					where: { idempotencyKey: `manual-cancel-${suffix}` },
				}),
			).toBe(0);
		});
	});
}
