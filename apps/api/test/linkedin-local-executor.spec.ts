import { describe, expect, it } from "bun:test";
import type {
	LinkedInBrowserAction,
	LinkedInBrowserAdapter,
	LinkedInBrowserOutcome,
} from "@crm/db";
import {
	LocalLinkedInExecutor,
	type LocalLinkedInExecutorCore,
	type PreparedConnectionExecution,
	type PreparedMessageExecution,
} from "../src/linkedin/local-linkedin-executor";

type RecordInput = {
	status: string;
	errorCode?: string | null;
	jobId: string;
	action?: string;
	externalConversationKey?: string | null;
};

function connectionAction(
	_jobId: string,
	state: "PENDING" | "CONNECTED" = "PENDING",
	profileIdentifier = "ada-lovelace",
): LinkedInBrowserOutcome {
	return {
		status: "CONFIRMED",
		externalRequestKey: null,
		browserProof: { page: "profile", relationshipState: state },
		observedIdentity: {
			resolution: "RESOLVED",
			profileUrl: "https://www.linkedin.com/in/ada-lovelace/",
			profileIdentifier,
			displayName: "Ada Lovelace",
			relationshipState: state,
		},
		observedAt: new Date("2026-09-24T10:00:00.000Z"),
	};
}

function messageAction(
	_jobId: string,
	state: "CONNECTED" = "CONNECTED",
	externalConversationKey: string | null = null,
): LinkedInBrowserOutcome {
	return {
		status: "CONFIRMED",
		externalMessageKey: "message-proof-1",
		externalConversationKey,
		browserProof: { page: "thread", relationshipState: state },
		observedIdentity: {
			resolution: "RESOLVED",
			profileUrl: "https://www.linkedin.com/in/ada-lovelace/",
			profileIdentifier: "ada-lovelace",
			displayName: "Ada Lovelace",
			relationshipState: state,
			externalConversationKey,
		},
		observedAt: new Date("2026-09-24T10:00:00.000Z"),
	};
}

function fakeCore(options: {
	connection?: PreparedConnectionExecution | null;
	message?: PreparedMessageExecution | null;
	blockedConnection?: string;
	blockedMessage?: string;
}) {
	let connectionClaim = options.connection
		? {
				id: "connection-job",
				contactId: "contact-1",
				routeId: "route-1",
				profileUrl: "https://www.linkedin.com/in/ada-lovelace/",
				profileIdentifier: "ada-lovelace",
			}
		: null;
	let messageClaim = options.message
		? {
				id: options.message.action.jobId,
				conversationId:
					options.message.action.target.conversationId ?? "conversation-1",
				messageId: "message-1",
				action: "MESSAGE" as const,
				status: "LEASED",
				attemptCount: options.message.attempt.attemptNumber,
			}
		: null;
	const records: RecordInput[] = [];
	const core: LocalLinkedInExecutorCore = {
		claimNextConnectionRequestJob: async () => {
			const claim = connectionClaim;
			connectionClaim = null;
			return claim;
		},
		beginConnectionRequestAttempt: async () =>
			options.blockedConnection
				? { blockedReason: options.blockedConnection }
				: (options.connection as PreparedConnectionExecution),
		recordConnectionRequestAttempt: async (input) => {
			records.push({ ...input, action: "CONNECTION_REQUEST" });
			return { status: input.status };
		},
		claimNextJob: async () => {
			const claim = messageClaim;
			messageClaim = null;
			return claim;
		},
		prepareMessageExecution: async () =>
			options.blockedMessage
				? { blockedReason: options.blockedMessage }
				: (options.message as PreparedMessageExecution),
		recordAttempt: async (input) => {
			records.push({ ...input, action: "MESSAGE" });
			return { status: input.status };
		},
	};
	return { core, records };
}

function connectionPrepared(): PreparedConnectionExecution {
	return {
		attempt: { id: "attempt-1", attemptNumber: 1 },
		job: {
			id: "connection-job",
			contactId: "contact-1",
			routeId: "route-1",
			profileUrl: "https://www.linkedin.com/in/ada-lovelace/",
			profileIdentifier: "ada-lovelace",
			displayName: "Ada Lovelace",
			actionPayload: { note: "Hello Ada" },
		},
	};
}

function messagePrepared(
	externalConversationKey: string | null = null,
): PreparedMessageExecution {
	return {
		attempt: { id: "attempt-2", attemptNumber: 1 },
		action: {
			jobId: "message-job",
			action: "MESSAGE",
			body: "Hello from Atlas",
			browserSessionKey: "worker-1",
			target: {
				contactId: "contact-1",
				routeId: "route-1",
				profileUrl: "https://www.linkedin.com/in/ada-lovelace/",
				profileIdentifier: "ada-lovelace",
				displayName: "Ada Lovelace",
				externalConversationKey,
			},
		},
	};
}

function fakeBrowser(outcome: LinkedInBrowserOutcome) {
	const actions: LinkedInBrowserAction[] = [];
	const browser: LinkedInBrowserAdapter = {
		execute: async (action) => {
			actions.push(action);
			return outcome;
		},
	};
	return { browser, actions };
}

describe("local LinkedIn executor", () => {
	it("performs one approved connection request and persists browser proof", async () => {
		const { core, records } = fakeCore({ connection: connectionPrepared() });
		const { browser, actions } = fakeBrowser(
			connectionAction("connection-job"),
		);
		const result = await new LocalLinkedInExecutor(
			core,
			browser,
			"worker-1",
		).runOnce();
		expect(result).toEqual({
			status: "COMPLETED",
			jobId: "connection-job",
			action: "CONNECTION_REQUEST",
		});
		expect(actions[0]?.note).toBe("Hello Ada");
		expect(records[0]?.status).toBe("SUCCEEDED");
	});

	it("requires a Pending relationship state as proof that a request was sent", async () => {
		const { core, records } = fakeCore({ connection: connectionPrepared() });
		const { browser } = fakeBrowser(
			connectionAction("connection-job", "CONNECTED"),
		);
		const result = await new LocalLinkedInExecutor(
			core,
			browser,
			"worker-1",
		).runOnce();
		expect(result).toMatchObject({
			status: "NEEDS_IHSAN",
			reason: "CONNECTION_RESULT_UNCLEAR",
		});
		expect(records[0]).toMatchObject({ status: "AMBIGUOUS" });
	});

	it("does not send when the connection is already pending", async () => {
		const { core, records } = fakeCore({ connection: connectionPrepared() });
		const { browser, actions } = fakeBrowser({
			status: "FAILED",
			errorCode: "CONNECTION_NOT_AVAILABLE",
			observedAt: new Date(),
		});
		const result = await new LocalLinkedInExecutor(
			core,
			browser,
			"worker-1",
		).runOnce();
		expect(result.status).toBe("FAILED");
		expect(actions).toHaveLength(1);
		expect(records[0]).toMatchObject({
			status: "FAILED",
			errorCode: "CONNECTION_NOT_AVAILABLE",
		});
	});

	it("blocks a job already connected or protected before browser execution", async () => {
		const blocked = fakeCore({
			connection: connectionPrepared(),
			blockedConnection: "LINKEDIN_CONNECTION_ALREADY_EXISTS",
		});
		const browser = fakeBrowser(connectionAction("connection-job"));
		const result = await new LocalLinkedInExecutor(
			blocked.core,
			browser.browser,
			"worker-1",
		).runOnce();
		expect(result).toMatchObject({
			status: "BLOCKED",
			reason: "LINKEDIN_CONNECTION_ALREADY_EXISTS",
		});
		expect(browser.actions).toHaveLength(0);

		const protectedCore = fakeCore({
			connection: connectionPrepared(),
			blockedConnection: "PERSON_OWNER_PROTECTED",
		});
		const protectedBrowser = fakeBrowser(connectionAction("connection-job"));
		const protectedResult = await new LocalLinkedInExecutor(
			protectedCore.core,
			protectedBrowser.browser,
			"worker-1",
		).runOnce();
		expect(protectedResult).toMatchObject({
			status: "BLOCKED",
			reason: "PERSON_OWNER_PROTECTED",
		});
		expect(protectedBrowser.actions).toHaveLength(0);
	});

	it("blocks organization suppression, quota, and CONTACT_ONCE collisions", async () => {
		for (const reason of [
			"ORGANIZATION_OWNER_PROTECTED",
			"LINKEDIN_SUPPRESSION",
			"LINKEDIN_CHANNEL_QUOTA_EXHAUSTED",
			"FIRST_TOUCH_CLAIMED_BY_OTHER_JOB",
		]) {
			const state = fakeCore({
				message: messagePrepared(),
				blockedMessage: reason,
			});
			const browser = fakeBrowser(messageAction("message-job"));
			const result = await new LocalLinkedInExecutor(
				state.core,
				browser.browser,
				"worker-1",
			).runOnce();
			expect(result).toMatchObject({ status: "BLOCKED", reason });
			expect(browser.actions).toHaveLength(0);
		}
	});

	it("handles successful existing-conversation messages without creating CRM conversations", async () => {
		const { core, records } = fakeCore({
			message: messagePrepared("thread-42"),
		});
		const { browser, actions } = fakeBrowser(
			messageAction("message-job", "CONNECTED", "thread-42"),
		);
		const result = await new LocalLinkedInExecutor(
			core,
			browser,
			"worker-1",
		).runOnce();
		expect(result.status).toBe("COMPLETED");
		expect(actions[0]?.target.externalConversationKey).toBe("thread-42");
		expect(records[0]).toMatchObject({
			action: "MESSAGE",
			status: "SUCCEEDED",
		});
	});

	it("handles a first message to a connected person without inventing a conversation", async () => {
		const { core, records } = fakeCore({ message: messagePrepared() });
		const { browser, actions } = fakeBrowser(
			messageAction("message-job", "CONNECTED", "thread-created-by-linkedin"),
		);
		const result = await new LocalLinkedInExecutor(
			core,
			browser,
			"worker-1",
		).runOnce();
		expect(result.status).toBe("COMPLETED");
		expect(actions[0]?.target.externalConversationKey).toBeNull();
		expect(records[0]?.externalConversationKey).toBe(
			"thread-created-by-linkedin",
		);
	});

	it("routes identity mismatch and wrong conversation to manual review", async () => {
		const identityMismatch = fakeCore({ connection: connectionPrepared() });
		const confirmed = connectionAction("connection-job");
		if (confirmed.status !== "CONFIRMED")
			throw new Error("test outcome must be confirmed");
		const mismatchBrowser = fakeBrowser({
			...confirmed,
			observedIdentity: {
				...confirmed.observedIdentity,
				profileIdentifier: "different-person",
			},
		});
		const mismatch = await new LocalLinkedInExecutor(
			identityMismatch.core,
			mismatchBrowser.browser,
			"worker-1",
		).runOnce();
		expect(mismatch).toMatchObject({
			status: "NEEDS_IHSAN",
			reason: "PROFILE_IDENTIFIER_MISMATCH",
		});
		expect(identityMismatch.records[0]?.status).toBe("AMBIGUOUS");

		const wrongConversation = fakeCore({
			message: messagePrepared("thread-42"),
		});
		const wrongBrowser = fakeBrowser({
			status: "AMBIGUOUS",
			errorCode: "WRONG_CONVERSATION",
			observedAt: new Date(),
		});
		const wrong = await new LocalLinkedInExecutor(
			wrongConversation.core,
			wrongBrowser.browser,
			"worker-1",
		).runOnce();
		expect(wrong).toMatchObject({
			status: "NEEDS_IHSAN",
			reason: "WRONG_CONVERSATION",
		});
	});

	it("does not retry a deterministic external conversation mismatch", async () => {
		const state = fakeCore({ message: messagePrepared("thread-42") });
		const browser = fakeBrowser({
			status: "FAILED",
			errorCode: "EXTERNAL_CONVERSATION_MISMATCH",
			observedAt: new Date(),
		});
		const result = await new LocalLinkedInExecutor(
			state.core,
			browser.browser,
			"worker-1",
		).runOnce();
		expect(result).toMatchObject({
			status: "NEEDS_IHSAN",
			reason: "EXTERNAL_CONVERSATION_MISMATCH",
		});
		expect(state.records[0]).toMatchObject({
			status: "FAILED",
			errorCode: "EXTERNAL_CONVERSATION_MISMATCH",
		});
	});

	it("fails closed for unavailable and unauthenticated browsers", async () => {
		for (const errorCode of [
			"BROWSER_UNAVAILABLE",
			"LINKEDIN_UNAUTHENTICATED",
		]) {
			const state = fakeCore({ message: messagePrepared() });
			const browser = fakeBrowser({
				status: "FAILED",
				errorCode,
				observedAt: new Date(),
			});
			const result = await new LocalLinkedInExecutor(
				state.core,
				browser.browser,
				"worker-1",
			).runOnce();
			expect(result).toMatchObject({ status: "FAILED", reason: errorCode });
			expect(state.records[0]?.status).toBe("FAILED");
		}
		const deterministic = fakeCore({ message: messagePrepared() });
		const deterministicBrowser = fakeBrowser({
			status: "FAILED",
			errorCode: "MESSAGE_EDITOR_UNAVAILABLE",
			observedAt: new Date(),
		});
		const deterministicResult = await new LocalLinkedInExecutor(
			deterministic.core,
			deterministicBrowser.browser,
			"worker-1",
		).runOnce();
		expect(deterministicResult).toMatchObject({
			status: "NEEDS_IHSAN",
			reason: "MESSAGE_EDITOR_UNAVAILABLE",
		});
		expect(deterministic.records[0]?.status).toBe("FAILED");
	});

	it("persists pre-typing composer diagnostics without recording a send", async () => {
		const state = fakeCore({ message: messagePrepared() });
		const proof = {
			phase: "pre-send-composer-availability",
			composer: { status: "LOADING", observations: 60 },
		};
		const browser = fakeBrowser({
			status: "FAILED",
			errorCode: "MESSAGE_EDITOR_UNAVAILABLE",
			browserProof: proof,
			observedAt: new Date(),
		});
		await new LocalLinkedInExecutor(
			state.core,
			browser.browser,
			"worker-1",
		).runOnce();
		expect(state.records).toHaveLength(1);
		expect(state.records[0]).toMatchObject({
			status: "FAILED",
			browserProof: proof,
			details: { browserProof: proof },
		});
	});

	it("retains review state when the editor or send control changes after typing may have begun", async () => {
		const state = fakeCore({ message: messagePrepared() });
		const browser = fakeBrowser({
			status: "AMBIGUOUS",
			errorCode: "MESSAGE_EDITOR_UNAVAILABLE",
			browserProof: { phase: "post-resolution-editor-or-send-control" },
			observedAt: new Date(),
		});
		const result = await new LocalLinkedInExecutor(
			state.core,
			browser.browser,
			"worker-1",
		).runOnce();
		expect(result.status).toBe("NEEDS_IHSAN");
		expect(state.records[0]?.status).toBe("AMBIGUOUS");
	});

	it("stops on CAPTCHA, security challenges, and ambiguous post-click results", async () => {
		for (const errorCode of [
			"CAPTCHA",
			"SECURITY_CHALLENGE",
			"SEND_STATE_UNCLEAR",
		]) {
			const state = fakeCore({ connection: connectionPrepared() });
			const browser = fakeBrowser({
				status: "AMBIGUOUS",
				errorCode: errorCode as "CAPTCHA",
				observedAt: new Date(),
			});
			const result = await new LocalLinkedInExecutor(
				state.core,
				browser.browser,
				"worker-1",
			).runOnce();
			expect(result).toMatchObject({
				status: "NEEDS_IHSAN",
				reason: errorCode,
			});
			expect(state.records[0]?.status).toBe("AMBIGUOUS");
		}
	});

	it("does not repeat a completed job on an idempotent rerun", async () => {
		const state = fakeCore({ connection: connectionPrepared() });
		const browser = fakeBrowser(connectionAction("connection-job"));
		const executor = new LocalLinkedInExecutor(
			state.core,
			browser.browser,
			"worker-1",
		);
		expect((await executor.runOnce()).status).toBe("COMPLETED");
		expect(await executor.runOnce()).toEqual({ status: "IDLE" });
		expect(browser.actions).toHaveLength(1);
		expect(state.records).toHaveLength(1);
	});
});
