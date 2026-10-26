import { describe, expect, it } from "bun:test";
import { LinkedInActionQueueService } from "../src/linkedin/linkedin-action-queue.service";

describe("LinkedIn production manual mode", () => {
	it("blocks the routine executor queue before creating a job", async () => {
		let modeChecks = 0;
		const service = new LinkedInActionQueueService(
			{} as never,
			{
				isAutonomousExecutionEnabled: async () => {
					modeChecks += 1;
					return false;
				},
			} as never,
		);
		const result = await service.queueRoutineAction({
			action: "ROUTINE_REPLY",
			conversationId: "conversation-manual-mode-test",
			body: "A concise, relevant reply.",
			idempotencyKey: "manual-mode-test-idempotency-key",
			context: {
				identityVerified: true,
				relationshipVerified: true,
				conversationVerified: true,
			},
		});
		expect(result).toMatchObject({
			classification: "BLOCKED",
			reason: "LINKEDIN_MANUAL_MODE_ACTIVE",
			jobId: null,
			approvedAt: null,
		});
		expect(modeChecks).toBe(1);
	});
});
