import { describe, expect, it } from "bun:test";

const testDatabaseUrl = process.env.PERSON_PROTECTION_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
	describe.skip("person protection database integration", () => {});
} else {
	const { db } = await import("@crm/db");
	const { coldOutreachBlockReason } = await import("../src/outreach-policy");
	const { LinkedInChannelService } = await import(
		"../../../apps/api/src/linkedin/linkedin-channel.service"
	);
	const { listAtlasOutreachQueue } = await import(
		"../../../apps/agent/agent/lib/atlas-outreach"
	);
	const { OutreachLifecycleService } = await import(
		"../../../apps/api/src/providers/outreach-lifecycle.service"
	);
	const { PersonProtectionService } = await import(
		"../../../apps/api/src/providers/person-protection.service"
	);

	describe("person protection database integration", () => {
		it("protects Fabrizio without suppressing coworkers and preserves audit history", async () => {
			const suffix = crypto.randomUUID();
			const humanId = `person-protection-human-${suffix}`;
			const approverId = `person-protection-approver-${suffix}`;
			const systemId = `person-protection-system-${suffix}`;
			const companyId = `person-protection-company-${suffix}`;
			const contactId = `fabrizio-romano-${suffix}`;
			const coworkerId = `person-protection-coworker-${suffix}`;
			const emailRouteId = `person-protection-email-route-${suffix}`;
			const alternateEmailRouteId = `person-protection-email-route-2-${suffix}`;
			const linkedinRouteId = `person-protection-linkedin-route-${suffix}`;
			const leadId = `person-protection-lead-${suffix}`;
			const followUpPlanId = `person-protection-follow-up-plan-${suffix}`;
			const followUpStepId = `person-protection-follow-up-step-${suffix}`;
			const followUpDraftId = `person-protection-follow-up-draft-${suffix}`;
			const followUpMailboxId = `person-protection-follow-up-mailbox-${suffix}`;
			const coworkerConversationId = `person-protection-coworker-conversation-${suffix}`;
			const profileUrl =
				"https://www.linkedin.com/in/fabrizio-romano-05708262/";
			const stableLinkedInId = `ACoAAA0uNcMBATjQVuG-D_Du4vuiQtR0A-LursY-${suffix}`;
			const service = new PersonProtectionService(db);
			const linkedin = new LinkedInChannelService(db);
			const lifecycle = new OutreachLifecycleService(db);

			await db.user.createMany({
				data: [
					{
						id: humanId,
						name: "Ihsan Protection Owner",
						email: `${humanId}@example.invalid`,
					},
					{
						id: approverId,
						name: "Protection Approver",
						email: `${approverId}@example.invalid`,
					},
					{
						id: systemId,
						name: "Atlas System Operator",
						email: `${systemId}@example.invalid`,
						kind: "SYSTEM_OPERATOR",
					},
				],
			});
			await db.company.create({
				data: { id: companyId, name: `Fabrizio Test Company ${suffix}` },
			});
			await db.contact.createMany({
				data: [
					{
						id: contactId,
						firstName: "Fabrizio",
						lastName: "Romano",
						linkedinUrl: profileUrl,
						companyId,
					},
					{
						id: coworkerId,
						firstName: "Una",
						lastName: "Coworker",
						companyId,
					},
				],
			});
			await db.contactRoute.createMany({
				data: [
					{
						id: emailRouteId,
						contactId,
						ownerUserId: humanId,
						type: "EMAIL",
						value: `${contactId}@example.invalid`,
						normalizedValue: `${contactId}@example.invalid`,
					},
					{
						id: linkedinRouteId,
						contactId,
						ownerUserId: humanId,
						type: "LINKEDIN",
						value: profileUrl,
						normalizedValue: stableLinkedInId,
					},
					{
						id: alternateEmailRouteId,
						contactId,
						ownerUserId: humanId,
						type: "EMAIL",
						value: `alternate-${contactId}@example.invalid`,
						normalizedValue: `alternate-${contactId}@example.invalid`,
					},
				],
			});
			const conversation = await linkedin.ensureConversation({
				contactId,
				companyId,
				identityKey: stableLinkedInId,
				profileUrl,
				normalizedProfileUrl: profileUrl,
				externalConversationKey: stableLinkedInId,
			});
			await db.linkedInConversation.update({
				where: { id: conversation.id },
				data: { connectionState: "CONNECTED" },
			});
			await db.linkedInConversation.create({
				data: {
					id: coworkerConversationId,
					contactId: coworkerId,
					companyId,
					identityKey: `${coworkerConversationId}:identity`,
					connectionState: "CONNECTED",
				},
			});
			await db.lead.create({
				data: {
					id: leadId,
					name: "Fabrizio Romano",
					stage: "READY",
					contactId,
					companyId,
					ownerUserId: humanId,
					createdByUserId: humanId,
					nextActionAt: new Date(Date.now() - 60_000),
					nextActionTitle: "Prepare first touch",
				},
			});

			expect(
				coldOutreachBlockReason({
					contactOutreachState: "ALLOWED",
					leadAttentionState: "NONE",
					channelStatus: "COLD_ELIGIBLE",
					otherChannelStatus: null,
					routeSuppressed: false,
					contactSuppressed: false,
					organizationSuppressed: false,
					firstTouchStatus: null,
					personProtected: true,
				}),
			).toBe("PERSON_OWNER_PROTECTED");

			const first = await service.activate(
				{ userId: humanId, role: "admin" },
				{
					contactId,
					reason: "Ihsan owns this relationship.",
					idempotencyKey: `manual-person-protection:${contactId}:1`,
				},
			);
			const duplicate = await service.activate(
				{ userId: humanId, role: "admin" },
				{
					contactId,
					reason: "Changed text must not create a duplicate.",
					idempotencyKey: `manual-person-protection:${contactId}:1`,
				},
			);
			expect(first.id).toBe(duplicate.id);
			expect(first.source).toBe("MANUAL_IHSAN");
			expect((await service.check(contactId))?.status).toBe("ACTIVE");
			expect(await service.check(coworkerId)).toBeNull();
			const atlasQueue = await listAtlasOutreachQueue({
				session: {
					auth: {
						current: {
							attributes: {
								purpose: "atlas-outreach",
								taskKind: "atlas-outreach",
							},
						},
						initiator: null,
					},
				},
			});
			expect(atlasQueue.some((lead) => lead.id === leadId)).toBe(false);

			let alternateRouteBlocked = false;
			try {
				await lifecycle.createPlan(humanId, {
					contactId,
					routeId: alternateEmailRouteId,
					steps: [],
				});
			} catch (error) {
				alternateRouteBlocked = true;
				expect((error as Error).message).toContain("PERSON_OWNER_PROTECTED");
			}
			expect(alternateRouteBlocked).toBe(true);

			await db.mailbox.create({
				data: {
					id: followUpMailboxId,
					ownerUserId: humanId,
					address: `${followUpMailboxId}@example.invalid`,
					normalizedAddress: `${followUpMailboxId}@example.invalid`,
					status: "VERIFIED",
					verifiedAt: new Date(),
				},
			});
			await db.draft.create({
				data: {
					id: followUpDraftId,
					ownerUserId: humanId,
					mailboxId: followUpMailboxId,
					recipientRouteId: emailRouteId,
					subject: "Protected follow-up",
					body: "This follow-up must be cancelled.",
					status: "DRAFT",
					idempotencyKey: `${followUpDraftId}:idempotency`,
				},
			});
			await db.outreachApproval.create({
				data: {
					draftId: followUpDraftId,
					requestedById: humanId,
					decidedById: approverId,
					status: "APPROVED",
					decidedAt: new Date(),
					idempotencyKey: `${followUpDraftId}:approval`,
				},
			});
			await db.draft.update({
				where: { id: followUpDraftId },
				data: { status: "APPROVED", approvedAt: new Date() },
			});
			await db.followUpPlan.create({
				data: {
					id: followUpPlanId,
					contactId,
					routeId: emailRouteId,
					ownerUserId: humanId,
					maxSteps: 1,
				},
			});
			await db.followUpStep.create({
				data: {
					id: followUpStepId,
					planId: followUpPlanId,
					position: 1,
					dueAt: new Date(Date.now() - 60_000),
					draftId: followUpDraftId,
					idempotencyKey: `${followUpStepId}:idempotency`,
				},
			});
			expect(await lifecycle.runDue(`person-protection-worker-${suffix}`)).toBe(
				1,
			);
			expect(
				await db.followUpStep.findUnique({
					where: { id: followUpStepId },
					select: { status: true, lastErrorCode: true },
				}),
			).toEqual({
				status: "CANCELLED",
				lastErrorCode: "PERSON_OWNER_PROTECTED",
			});
			expect(
				await db.domainAuditEvent.count({
					where: {
						action: "PERSON_PROTECTION_ACTIVATED",
						entityId: contactId,
					},
				}),
			).toBe(1);

			let emailFollowUpBlocked = false;
			try {
				await lifecycle.createPlan(humanId, {
					contactId,
					routeId: emailRouteId,
					steps: [],
				});
			} catch (error) {
				emailFollowUpBlocked = true;
				expect((error as Error).message).toContain("PERSON_OWNER_PROTECTED");
			}
			expect(emailFollowUpBlocked).toBe(true);

			for (const action of ["CONNECTION_REQUEST", "MESSAGE"] as const) {
				let blocked = false;
				try {
					await linkedin.queueAction({
						conversationId: conversation.id,
						action,
						body: action === "MESSAGE" ? "This must not be sent." : undefined,
						idempotencyKey: `${conversation.id}:${action.toLowerCase()}`,
						approvedAt: new Date(),
					});
				} catch (error) {
					blocked = true;
					expect((error as Error).message).toContain("PERSON_OWNER_PROTECTED");
				}
				expect(blocked).toBe(true);
			}

			const coworkerJob = await linkedin.queueAction({
				conversationId: coworkerConversationId,
				action: "MESSAGE",
				body: "Coworker relationship remains available.",
				idempotencyKey: `${coworkerConversationId}:message`,
				approvedAt: new Date(),
				messageLimit: 1,
			});
			expect(coworkerJob.status).toBe("PENDING");

			let systemReleaseRejected = false;
			try {
				await service.release(
					{ userId: systemId, role: "admin" },
					{ contactId, reason: "Atlas cannot release manual protection." },
				);
			} catch (error) {
				systemReleaseRejected = true;
				expect((error as Error).message).toContain("authorized human");
			}
			expect(systemReleaseRejected).toBe(true);

			const released = await service.release(
				{ userId: humanId, role: "admin" },
				{ contactId, reason: "Ihsan explicitly released this relationship." },
			);
			const repeatedRelease = await service.release(
				{ userId: humanId, role: "admin" },
				{ contactId, reason: "Repeated release is idempotent." },
			);
			expect(released.status).toBe("RELEASED");
			expect(repeatedRelease.id).toBe(released.id);
			expect(await service.check(contactId)).toBeNull();
			expect(
				await db.domainAuditEvent.count({
					where: {
						action: "PERSON_PROTECTION_RELEASED",
						entityId: contactId,
					},
				}),
			).toBe(1);

			const second = await service.activate(
				{ userId: humanId, role: "admin" },
				{
					contactId,
					reason: "Protection renewed by Ihsan.",
					idempotencyKey: `manual-person-protection:${contactId}:2`,
				},
			);
			expect(second.id).not.toBe(first.id);
			expect(await db.personProtection.count({ where: { contactId } })).toBe(2);
			let contactDeleteFailed = false;
			try {
				await db.contact.delete({ where: { id: contactId } });
			} catch {
				contactDeleteFailed = true;
			}
			expect(contactDeleteFailed).toBe(true);
		});
	});
}
