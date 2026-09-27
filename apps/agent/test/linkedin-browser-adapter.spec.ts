import { describe, expect, it } from "bun:test";
import {
	isManualReviewOutcome,
	verifyFreshLinkedInIdentity,
	verifyLinkedInActionState,
} from "../agent/lib/linkedin-browser-adapter";

describe("LinkedIn browser adapter outcomes", () => {
	it("routes security and ambiguous outcomes to manual review", () => {
		expect(
			isManualReviewOutcome({
				status: "AMBIGUOUS",
				errorCode: "CAPTCHA",
				observedAt: new Date(),
			}),
		).toBe(true);
	});

	it("accepts only confirmed outcomes as confirmed execution", () => {
		expect(
			isManualReviewOutcome({
				status: "CONFIRMED",
				observedAt: new Date(),
			}),
		).toBe(false);
	});

	const target = {
		contactId: "contact-1",
		routeId: "route-1",
		profileUrl: "https://www.linkedin.com/in/example-1/",
		profileIdentifier: "example-1",
	};

	it("allows a fresh observation of the exact target", () => {
		expect(
			verifyFreshLinkedInIdentity(target, {
				resolution: "RESOLVED",
				profileUrl: target.profileUrl,
				profileIdentifier: target.profileIdentifier,
			}),
		).toEqual({ allowed: true });
	});

	it("does not use a stale UI index as identity evidence", () => {
		expect(
			verifyFreshLinkedInIdentity(target, {
				resolution: "RESOLVED",
				profileUrl: target.profileUrl,
				profileIdentifier: target.profileIdentifier,
				uiElementIndex: 99,
			}),
		).toEqual({ allowed: true });
	});

	it("blocks a profile URL mismatch", () => {
		expect(
			verifyFreshLinkedInIdentity(target, {
				resolution: "RESOLVED",
				profileUrl: "https://www.linkedin.com/in/another/",
				profileIdentifier: "another",
			}),
		).toEqual({ allowed: false, reason: "PROFILE_URL_MISMATCH" });
	});

	it("blocks a stable profile identifier mismatch", () => {
		expect(
			verifyFreshLinkedInIdentity(target, {
				resolution: "RESOLVED",
				profileUrl: target.profileUrl,
				profileIdentifier: "another",
			}),
		).toEqual({ allowed: false, reason: "PROFILE_IDENTIFIER_MISMATCH" });
	});

	it("canonicalizes profile URLs and verifies the visible name", () => {
		expect(
			verifyFreshLinkedInIdentity(
				{
					...target,
					profileUrl: "https://www.linkedin.com/in/example-1",
					displayName: "Example Person",
				},
				{
					resolution: "RESOLVED",
					profileUrl: target.profileUrl,
					profileIdentifier: target.profileIdentifier,
					displayName: "Example Person",
				},
			),
		).toEqual({ allowed: true });
		expect(
			verifyFreshLinkedInIdentity(
				{ ...target, displayName: "Example Person" },
				{
					resolution: "RESOLVED",
					profileUrl: target.profileUrl,
					profileIdentifier: target.profileIdentifier,
					displayName: "Another Person",
				},
			),
		).toEqual({ allowed: false, reason: "DISPLAY_NAME_MISMATCH" });
	});

	it("requires the expected current relationship state for each action", () => {
		expect(
			verifyLinkedInActionState(
				{
					jobId: "job-1",
					action: "CONNECTION_REQUEST",
					target,
					browserSessionKey: "worker-1",
				},
				{
					resolution: "RESOLVED",
					profileUrl: target.profileUrl,
					profileIdentifier: target.profileIdentifier,
					relationshipState: "PENDING",
				},
			),
		).toEqual({ allowed: false, reason: "CONNECTION_NOT_AVAILABLE" });
		expect(
			verifyLinkedInActionState(
				{
					jobId: "job-2",
					action: "MESSAGE",
					target,
					browserSessionKey: "worker-1",
				},
				{
					resolution: "RESOLVED",
					profileUrl: target.profileUrl,
					profileIdentifier: target.profileIdentifier,
					relationshipState: "CONNECT",
				},
			),
		).toEqual({ allowed: false, reason: "LINKEDIN_CONNECTION_REQUIRED" });
	});

	it("blocks a wrong conversation for a message action", () => {
		expect(
			verifyFreshLinkedInIdentity(
				{ ...target, conversationId: "conversation-1" },
				{
					resolution: "RESOLVED",
					profileUrl: target.profileUrl,
					profileIdentifier: target.profileIdentifier,
					conversationId: "conversation-2",
				},
			),
		).toEqual({ allowed: false, reason: "CONVERSATION_ID_MISMATCH" });
	});

	it("blocks ambiguous browser identity evidence", () => {
		expect(
			verifyFreshLinkedInIdentity(target, {
				resolution: "AMBIGUOUS",
				profileUrl: null,
				profileIdentifier: null,
			}),
		).toEqual({ allowed: false, reason: "BROWSER_STATE_AMBIGUOUS" });
	});
});
