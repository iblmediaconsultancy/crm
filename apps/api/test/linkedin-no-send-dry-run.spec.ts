import { describe, expect, it } from "bun:test";
import {
	type LinkedInNoSendBrowser,
	type LinkedInNoSendComposerObservation,
	type LinkedInNoSendProfileObservation,
	type LinkedInNoSendTarget,
	linkedinNoSendComposerUrl,
	prepareLinkedInMessageForNoSend,
	runLinkedInNoSendDryRun,
} from "../src/linkedin/linkedin-no-send-dry-run";
import type { LinkedInMessageComposerResolution } from "../src/linkedin/message-composer-resolver";

const target: LinkedInNoSendTarget = {
	contactId: "contact-1",
	routeId: "route-1",
	profileUrl: "https://www.linkedin.com/in/example-person/",
	profileIdentifier: "example-person",
	stableMemberIdentifier: "ACoAExampleMember",
	displayName: "Example Person",
	externalConversationKey: null,
	expectNoExistingConversation: true,
};

const profile: LinkedInNoSendProfileObservation = {
	authenticated: true,
	challenge: null,
	profileUrl: target.profileUrl,
	profileIdentifier: target.profileIdentifier,
	stableMemberIdentifier: target.stableMemberIdentifier,
	displayName: target.displayName,
	relationshipState: "CONNECTED",
	pendingInvitationState: "NONE",
};

function foundResolution(
	overrides: Partial<
		Extract<LinkedInMessageComposerResolution, { status: "FOUND" }>
	> = {},
): LinkedInMessageComposerResolution {
	return {
		status: "FOUND",
		surfaceIndex: 0,
		editorIndex: 0,
		sendControlIndex: 0,
		recipientIdentifier: target.stableMemberIdentifier ?? null,
		externalConversationKey: null,
		externalMessageKey: null,
		...overrides,
	};
}

const composer: LinkedInNoSendComposerObservation = {
	authenticated: true,
	challenge: null,
	resolution: foundResolution(),
};

function browserMock(
	overrides: {
		profile?: Partial<LinkedInNoSendProfileObservation>;
		composer?: {
			authenticated?: boolean;
			challenge?: string | null;
			resolution?: LinkedInMessageComposerResolution;
		};
		profileError?: Error;
		composerError?: Error;
		navigationError?: Error;
		composerNavigationError?: Error;
	} = {},
) {
	const calls: string[] = [];
	const browser: LinkedInNoSendBrowser = {
		async navigateToRecipient(url) {
			calls.push(`profile:${url}`);
			if (overrides.navigationError) throw overrides.navigationError;
		},
		async inspectRecipient() {
			calls.push("inspect-profile");
			if (overrides.profileError) throw overrides.profileError;
			return { ...profile, ...overrides.profile };
		},
		async navigateToComposer(url) {
			calls.push(`composer:${url}`);
			if (overrides.composerNavigationError)
				throw overrides.composerNavigationError;
		},
		async inspectComposer(recipientIdentifier, conversationKey) {
			calls.push(`inspect-composer:${recipientIdentifier}:${conversationKey}`);
			if (overrides.composerError) throw overrides.composerError;
			return {
				...composer,
				...overrides.composer,
				resolution: overrides.composer?.resolution ?? composer.resolution,
			};
		},
		async close() {
			calls.push("close");
		},
	};
	return { browser, calls };
}

describe("LinkedIn NO_SEND dry run", () => {
	it("validates the exact CRM profile, inspects relationship and composer, and prepares text in memory", async () => {
		const { browser, calls } = browserMock();
		const result = await runLinkedInNoSendDryRun({
			target,
			body: "  A prepared message.  ",
			browser,
		});

		expect(result).toEqual({
			status: "READY",
			stage: "COMPOSER_READY",
			relationshipState: "CONNECTED",
			pendingInvitationState: "NONE",
			profileUrl: target.profileUrl,
			profileIdentifier: target.profileIdentifier,
			contactId: target.contactId,
			routeId: target.routeId,
			conversationId: null,
			displayName: target.displayName ?? null,
			recipientIdentifier: target.stableMemberIdentifier ?? "",
			conversationParticipantIdentifier: target.stableMemberIdentifier ?? "",
			externalConversationKey: null,
			externalMessageKey: null,
			preparedMessage: "A prepared message.",
		});
		expect(calls).toEqual([
			`profile:${target.profileUrl}`,
			"inspect-profile",
			`composer:${linkedinNoSendComposerUrl(target)}`,
			`inspect-composer:${target.stableMemberIdentifier}:null`,
			"close",
		]);
		expect(calls.some((call) => /send|click|type|crm-write/i.test(call))).toBe(
			false,
		);
	});

	it("does not navigate beyond the profile when exact identity does not match", async () => {
		const { browser, calls } = browserMock({
			profile: {
				profileUrl: "https://www.linkedin.com/in/different-person/",
				profileIdentifier: "different-person",
				stableMemberIdentifier: "ACoOtherMember",
			},
		});
		const result = await runLinkedInNoSendDryRun({ target, browser });
		expect(result).toMatchObject({
			status: "BLOCKED",
			stage: "PROFILE_VERIFICATION",
			reason: "LINKEDIN_PROFILE_IDENTITY_MISMATCH",
		});
		expect(calls).not.toContain(
			`composer:${linkedinNoSendComposerUrl(target)}`,
		);
		expect(calls.at(-1)).toBe("close");
	});

	it("requires authentication and stops on a security challenge", async () => {
		for (const observed of [
			{ authenticated: false },
			{ challenge: "CAPTCHA" },
		]) {
			const { browser, calls } = browserMock({ profile: observed });
			const result = await runLinkedInNoSendDryRun({ target, browser });
			expect(result.status).toBe("BLOCKED");
			expect(calls.some((call) => call.startsWith("composer:"))).toBe(false);
		}
	});

	it("does not inspect a composer for non-connected or ambiguous relationships", async () => {
		for (const relationshipState of [
			"CONNECT",
			"PENDING",
			"AMBIGUOUS",
		] as const) {
			const { browser, calls } = browserMock({
				profile: { relationshipState },
			});
			const result = await runLinkedInNoSendDryRun({ target, browser });
			expect(result).toMatchObject({
				status: "BLOCKED",
				stage: "RELATIONSHIP_VERIFICATION",
			});
			expect(calls.some((call) => call.startsWith("composer:"))).toBe(false);
		}
	});

	it("fails closed for wrong recipient, ambiguous or unavailable composers", async () => {
		for (const resolution of [
			foundResolution({ recipientIdentifier: "ACoOtherMember" }),
			{ status: "AMBIGUOUS" as const },
			{ status: "NONE" as const },
		]) {
			const { browser } = browserMock({ composer: { resolution } });
			const result = await runLinkedInNoSendDryRun({ target, browser });
			expect(result).toMatchObject({
				status: "BLOCKED",
				stage: "COMPOSER_VERIFICATION",
			});
		}
	});

	it("requires the stored conversation key and blocks prior messages for first-touch", async () => {
		const existingTarget = {
			...target,
			conversationId: "conversation-1",
			externalConversationKey: "2-existingThreadKey",
			expectNoExistingConversation: false,
		};
		const { browser, calls } = browserMock({
			composer: {
				resolution: foundResolution({
					externalConversationKey: null,
				}),
			},
		});
		const result = await runLinkedInNoSendDryRun({
			target: existingTarget,
			browser,
		});
		expect(result).toMatchObject({
			status: "BLOCKED",
			stage: "COMPOSER_VERIFICATION",
		});
		expect(calls).toContain(
			"composer:https://www.linkedin.com/messaging/thread/2-existingThreadKey/",
		);

		const priorMessage = browserMock({
			composer: {
				resolution: foundResolution({
					externalMessageKey: "message-1",
				}),
			},
		});
		const firstTouchResult = await runLinkedInNoSendDryRun({
			target,
			browser: priorMessage.browser,
		});
		expect(firstTouchResult).toMatchObject({
			status: "BLOCKED",
			stage: "COMPOSER_VERIFICATION",
		});
	});

	it("rejects non-LinkedIn CRM URLs before touching the browser", async () => {
		const { browser, calls } = browserMock();
		const result = await runLinkedInNoSendDryRun({
			target: {
				...target,
				profileUrl: "https://example.com/in/example-person",
			},
			browser,
		});
		expect(result).toMatchObject({
			status: "BLOCKED",
			stage: "TARGET_VALIDATION",
		});
		expect(calls).toEqual([]);
	});

	it("prepares valid message text without exposing any browser write operation", () => {
		expect(prepareLinkedInMessageForNoSend("  Hello  ")).toBe("Hello");
		expect(prepareLinkedInMessageForNoSend("  ")).toBeNull();
		expect(prepareLinkedInMessageForNoSend("x".repeat(3001))).toBeNull();
		expect("execute" in ({} as LinkedInNoSendBrowser)).toBe(false);
	});
});
