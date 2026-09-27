import { describe, expect, it } from "bun:test";
import {
	classifyLinkedInAction,
	LINKEDIN_ACTION_POLICY_VERSION,
} from "../src/linkedin/linkedin-action-policy";

describe("Atlas LinkedIn routine-action policy", () => {
	it("classifies routine message action types as autonomous", () => {
		for (const action of [
			"FIRST_MESSAGE_TO_CONNECTED_PERSON",
			"EXISTING_CONVERSATION_MESSAGE",
			"ROUTINE_REPLY",
		] as const) {
			expect(
				classifyLinkedInAction({
					action,
					body: "A relevant player update without commercial terms.",
				}),
			).toEqual({ classification: "ROUTINE_AUTONOMOUS", reason: null });
		}
	});

	it("keeps connection requests and player qualification routine", () => {
		expect(classifyLinkedInAction({ action: "CONNECTION_REQUEST" })).toEqual({
			classification: "ROUTINE_AUTONOMOUS",
			reason: null,
		});
		expect(
			classifyLinkedInAction({
				action: "ROUTINE_REPLY",
				body: "I can share a non-priced assessment of the player's current profile.",
			}),
		).toEqual({ classification: "ROUTINE_AUTONOMOUS", reason: null });
	});

	it("routes commercial commitments and pricing to Ihsan", () => {
		for (const body of [
			"What is your pricing?",
			"I can send a proposal.",
			"Let's negotiate the contract.",
			"Can we confirm a meeting?",
		]) {
			expect(
				classifyLinkedInAction({ action: "ROUTINE_REPLY", body }),
			).toMatchObject({ classification: "WITH_IHSAN" });
		}
		expect(
			classifyLinkedInAction({
				action: "ROUTINE_REPLY",
				body: "A routine update.",
				context: { explicitIhsanRequest: true },
			}),
		).toEqual({
			classification: "WITH_IHSAN",
			reason: "EXPLICIT_IHSAN_REQUEST",
		});
	});

	it("fails closed for identity and conversation uncertainty", () => {
		expect(
			classifyLinkedInAction({
				action: "EXISTING_CONVERSATION_MESSAGE",
				body: "A routine reply.",
				context: { identityVerified: false },
			}),
		).toEqual({
			classification: "AMBIGUOUS_REVIEW_REQUIRED",
			reason: "IDENTITY_NOT_VERIFIED",
		});
		expect(
			classifyLinkedInAction({
				action: "ROUTINE_REPLY",
				body: "A routine reply.",
				context: { conversationVerified: false },
			}),
		).toEqual({
			classification: "AMBIGUOUS_REVIEW_REQUIRED",
			reason: "CONVERSATION_NOT_VERIFIED",
		});
	});

	it("blocks missing message copy without changing policy version", () => {
		expect(
			classifyLinkedInAction({
				action: "EXISTING_CONVERSATION_MESSAGE",
				body: "   ",
			}),
		).toEqual({ classification: "BLOCKED", reason: "MESSAGE_BODY_REQUIRED" });
		expect(LINKEDIN_ACTION_POLICY_VERSION).toBe("linkedin-routine-v1");
	});
});
