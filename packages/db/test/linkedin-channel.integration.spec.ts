import { afterAll, describe, expect, it } from "bun:test";

const dbPackage = process.env.DATABASE_URL ? await import("../src") : null;
const database = dbPackage?.db ?? null;
if (dbPackage) dbPackage.setPrismaLogSink(() => {});
const integration = database ? it : it.skip;

describe("LinkedIn channel database safety", () => {
	integration(
		"enforces shared claims, stale Lead conflicts, and job idempotency",
		async () => {
			if (!database) return;
			const suffix = `linkedin-test-${Date.now()}`;
			const userId = `${suffix}-user`;
			const contactId = `${suffix}-contact`;
			const leadId = `${suffix}-lead`;
			const conversationId = `${suffix}-conversation`;
			const jobId = `${suffix}-job`;
			const claimId = `${suffix}-claim`;
			try {
				await database.user.create({
					data: {
						id: userId,
						name: "LinkedIn Test",
						email: `${suffix}@example.test`,
					},
				});
				await database.contact.create({
					data: {
						id: contactId,
						firstName: "LinkedIn",
						lastName: "Test",
						ownerId: userId,
					},
				});
				await database.lead.create({
					data: {
						id: leadId,
						name: "LinkedIn Test",
						contactId,
						ownerUserId: userId,
						createdByUserId: userId,
					},
				});
				const conversation = await database.linkedInConversation.create({
					data: {
						id: conversationId,
						contactId,
						leadId,
						identityKey: `${suffix}-identity`,
					},
				});
				await database.relationshipColdTouchClaim.create({
					data: {
						id: claimId,
						contactId,
						channel: "LINKEDIN",
						idempotencyKey: `${suffix}-claim-key`,
					},
				});
				let duplicateClaimRejected = false;
				try {
					await database.relationshipColdTouchClaim.create({
						data: {
							id: `${suffix}-duplicate-claim`,
							contactId,
							channel: "EMAIL",
							idempotencyKey: `${suffix}-duplicate-claim-key`,
						},
					});
				} catch {
					duplicateClaimRejected = true;
				}
				expect(duplicateClaimRejected).toBe(true);

				await database.linkedInSendJob.create({
					data: {
						id: jobId,
						conversationId: conversation.id,
						action: "MESSAGE",
						quotaDay: new Date(),
						idempotencyKey: `${suffix}-job-key`,
					},
				});
				let duplicateJobRejected = false;
				try {
					await database.linkedInSendJob.create({
						data: {
							id: `${suffix}-duplicate-job`,
							conversationId: conversation.id,
							action: "MESSAGE",
							quotaDay: new Date(),
							idempotencyKey: `${suffix}-job-key`,
						},
					});
				} catch {
					duplicateJobRejected = true;
				}
				expect(duplicateJobRejected).toBe(true);

				const initialLead = await database.lead.findUniqueOrThrow({
					where: { id: leadId },
					select: { version: true },
				});
				const results = await Promise.all([
					database.lead.updateMany({
						where: { id: leadId, version: initialLead.version },
						data: { attentionState: "NEEDS_IHSAN" },
					}),
					database.lead.updateMany({
						where: { id: leadId, version: initialLead.version },
						data: { attentionState: "WITH_IHSAN" },
					}),
				]);
				expect(results.map((result) => result.count).sort()).toEqual([0, 1]);
			} finally {
				await database.linkedInSendJob.deleteMany({ where: { id: jobId } });
				await database.linkedInConversation.deleteMany({
					where: { id: conversationId },
				});
				await database.relationshipColdTouchClaim.deleteMany({
					where: { id: claimId },
				});
				await database.lead.deleteMany({ where: { id: leadId } });
				await database.contact.deleteMany({ where: { id: contactId } });
				await database.user.deleteMany({ where: { id: userId } });
			}
		},
	);
});

afterAll(async () => {
	if (database) await database.$disconnect();
});
