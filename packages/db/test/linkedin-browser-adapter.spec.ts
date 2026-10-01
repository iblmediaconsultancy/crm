import { describe, expect, it } from "bun:test";
import {
	canonicalLinkedInProfileIdentity,
	canonicalLinkedInProfileUrl,
	firstMessageBrowserStateAllowsSend,
	linkedInConversationIdentityMatches,
	linkedInDisplayNamesMatch,
	linkedInProfileRecordsMatch,
	resolveLinkedInComposeConversationEvidence,
	verifyFreshLinkedInIdentity,
	verifyLinkedInActionState,
} from "../src/linkedin-browser-adapter";

const baseObserved = {
	resolution: "RESOLVED" as const,
	profileUrl: "https://www.linkedin.com/in/ada-lovelace/",
	profileIdentifier: "ada-lovelace",
	displayName: "Ada Lovelace",
};

function target(
	profileUrl: string,
	profileIdentifier: string,
	displayName = "Ada Lovelace",
) {
	return {
		contactId: "contact-1",
		routeId: "route-1",
		profileUrl,
		profileIdentifier,
		displayName,
	};
}

describe("LinkedIn browser identity canonicalization", () => {
	it("accepts the René host/path route identifier and browser slug", () => {
		expect(
			verifyFreshLinkedInIdentity(
				target(
					"https://www.linkedin.com/in/ren%C3%A9-vonk-516a20225/",
					"linkedin.com/in/ren%c3%a9-vonk-516a20225",
					"René Vonk",
				),
				{
					...baseObserved,
					profileUrl: "https://www.linkedin.com/in/ren%C3%A9-vonk-516a20225/",
					profileIdentifier: "ren%C3%A9-vonk-516a20225",
					displayName: "René Vonk",
				},
			),
		).toEqual({ allowed: true });
	});

	it("normalizes www, trailing slash, and percent-encoding case", () => {
		expect(
			canonicalLinkedInProfileUrl(
				"https://WWW.LinkedIn.com/in/ren%c3%a9-vonk-516a20225/?trk=profile",
			),
		).toBe("https://linkedin.com/in/ren%c3%a9-vonk-516a20225/");
		expect(
			canonicalLinkedInProfileIdentity("/in/ren%C3%A9-vonk-516a20225"),
		).toEqual({ kind: "PROFILE_SLUG", value: "ren%c3%a9-vonk-516a20225" });
	});

	it("accepts an exact normal slug and rejects a different slug", () => {
		expect(
			verifyFreshLinkedInIdentity(
				target("https://linkedin.com/in/ada-lovelace", "ada-lovelace"),
				baseObserved,
			),
		).toEqual({ allowed: true });
		expect(
			verifyFreshLinkedInIdentity(
				target("https://linkedin.com/in/ada-lovelace", "different-person"),
				baseObserved,
			),
		).toEqual({ allowed: false, reason: "PROFILE_IDENTIFIER_MISMATCH" });
	});

	it("matches a historical full profile URL stored as the identifier", () => {
		expect(
			linkedInProfileRecordsMatch(
				{
					profileUrl:
						"https://www.linkedin.com/in/gijs-van-der-velden-856a42128/",
					profileIdentifier: "gijs-van-der-velden-856a42128",
				},
				{
					profileUrl: "https://linkedin.com/in/gijs-van-der-velden-856a42128",
					profileIdentifier:
						"https://www.linkedin.com/in/gijs-van-der-velden-856a42128/",
				},
			),
		).toBe(true);
		expect(
			linkedInProfileRecordsMatch(
				{
					profileUrl:
						"https://www.linkedin.com/in/gijs-van-der-velden-856a42128/",
					profileIdentifier: "gijs-van-der-velden-856a42128",
				},
				{
					profileUrl: "https://linkedin.com/in/another-person/",
					profileIdentifier: "https://www.linkedin.com/in/another-person/",
				},
			),
		).toBe(false);
	});

	it("proves a CRM slug and opaque member identifier are the same route", () => {
		expect(
			linkedInProfileRecordsMatch(
				{
					profileUrl: "https://www.linkedin.com/in/adis-doksanaltic-02138a272/",
					profileIdentifier: "adis-doksanaltic-02138a272",
					stableMemberIdentifier: "ACoAdisMember",
				},
				{
					profileUrl: "https://linkedin.com/in/adis-doksanaltic-02138a272",
					profileIdentifier: "ACoAdisMember",
					stableMemberIdentifier: "ACoAdisMember",
				},
			),
		).toBe(true);
	});

	it("proves a CRM member identifier and matching slug are the same route", () => {
		expect(
			linkedInProfileRecordsMatch(
				{
					profileUrl: "https://linkedin.com/in/adis-doksanaltic-02138a272",
					profileIdentifier: "ACoAdisMember",
					stableMemberIdentifier: "ACoAdisMember",
				},
				{
					profileUrl: "https://www.linkedin.com/in/adis-doksanaltic-02138a272/",
					profileIdentifier: "adis-doksanaltic-02138a272",
				},
			),
		).toBe(true);
	});

	it("accepts a vanity redirect only with matching stable member evidence", () => {
		expect(
			linkedInProfileRecordsMatch(
				{
					profileUrl: "https://linkedin.com/in/old-adis-slug",
					profileIdentifier: "old-adis-slug",
					stableMemberIdentifier: "ACoAdisMember",
				},
				{
					profileUrl: "https://linkedin.com/in/new-adis-slug",
					profileIdentifier: "new-adis-slug",
					stableMemberIdentifier: "ACoAdisMember",
				},
			),
		).toBe(true);
	});

	it("rejects conflicting member identifiers, slugs, and missing evidence", () => {
		expect(
			linkedInProfileRecordsMatch(
				{
					profileUrl: "https://linkedin.com/in/adis-doksanaltic-02138a272",
					profileIdentifier: "adis-doksanaltic-02138a272",
					stableMemberIdentifier: "ACoAdisMember",
				},
				{
					profileUrl: "https://linkedin.com/in/adis-doksanaltic-02138a272",
					profileIdentifier: "ACoOtherMember",
				},
			),
		).toBe(false);
		expect(
			linkedInProfileRecordsMatch(
				{
					profileUrl: "https://linkedin.com/in/adis-doksanaltic-02138a272",
					profileIdentifier: "adis-doksanaltic-02138a272",
				},
				{
					profileUrl: "https://linkedin.com/in/another-person",
					profileIdentifier: "another-person",
				},
			),
		).toBe(false);
		expect(
			linkedInProfileRecordsMatch(
				{
					profileUrl: "https://linkedin.com/in/adis-doksanaltic-02138a272",
					profileIdentifier: "adis-doksanaltic-02138a272",
				},
				{
					profileUrl: "https://linkedin.com/in/adis-doksanaltic-02138a272",
					profileIdentifier: null,
				},
			),
		).toBe(false);
	});

	it("fails closed when the stable identifier changes between queue and execution", () => {
		expect(
			linkedInProfileRecordsMatch(
				{
					profileUrl: "https://linkedin.com/in/adis-doksanaltic-02138a272",
					profileIdentifier: "adis-doksanaltic-02138a272",
					stableMemberIdentifier: "ACoAdisMember",
				},
				{
					profileUrl: "https://linkedin.com/in/adis-doksanaltic-02138a272",
					profileIdentifier: "adis-doksanaltic-02138a272",
					stableMemberIdentifier: "ACoChangedMember",
				},
			),
		).toBe(false);
	});

	it("requires final browser recipient re-resolution to match the stored member", () => {
		const storedTarget = target(
			"https://linkedin.com/in/old-adis-slug",
			"old-adis-slug",
			"Adis Doksanltic",
		);
		expect(
			verifyFreshLinkedInIdentity(
				{ ...storedTarget, stableMemberIdentifier: "ACoAdisMember" },
				{
					...baseObserved,
					profileUrl: "https://linkedin.com/in/new-adis-slug",
					profileIdentifier: "new-adis-slug",
					displayName: "Adis Doksanltic",
					conversationParticipantIdentifier: "ACoAdisMember",
				},
			),
		).toEqual({ allowed: true });
		expect(
			verifyFreshLinkedInIdentity(
				{ ...storedTarget, stableMemberIdentifier: "ACoAdisMember" },
				{
					...baseObserved,
					profileUrl: "https://linkedin.com/in/new-adis-slug",
					profileIdentifier: "new-adis-slug",
					displayName: "Adis Doksanltic",
					conversationParticipantIdentifier: "ACoOtherMember",
				},
			),
		).toEqual({ allowed: false, reason: "PROFILE_URL_MISMATCH" });
	});

	it("rejects a redirected profile and a visible identity mismatch", () => {
		expect(
			verifyFreshLinkedInIdentity(
				target("https://linkedin.com/in/ada-lovelace", "ada-lovelace"),
				{
					...baseObserved,
					profileUrl: "https://linkedin.com/in/grace-hopper/",
					profileIdentifier: "grace-hopper",
				},
			),
		).toEqual({ allowed: false, reason: "PROFILE_URL_MISMATCH" });
		expect(
			verifyFreshLinkedInIdentity(
				target("https://linkedin.com/in/ada-lovelace", "ada-lovelace"),
				{ ...baseObserved, displayName: "Grace Hopper" },
			),
		).toEqual({ allowed: false, reason: "DISPLAY_NAME_MISMATCH" });
	});

	it("keeps opaque stable identifiers strict", () => {
		expect(
			canonicalLinkedInProfileIdentity(
				"ACoAAA0uNcMBATjQVuG-D_Du4vuiQtR0A-LursY",
			),
		).toEqual({
			kind: "OPAQUE",
			value: "ACoAAA0uNcMBATjQVuG-D_Du4vuiQtR0A-LursY",
		});
		expect(
			verifyFreshLinkedInIdentity(
				target(
					"https://linkedin.com/in/fabrizio-romano-05708262",
					"ACoAAA0uNcMBATjQVuG-D_Du4vuiQtR0A-LursY",
				),
				{
					...baseObserved,
					profileUrl: "https://linkedin.com/in/fabrizio-romano-05708262",
					profileIdentifier: "fabrizio-romano-05708262",
				},
			),
		).toEqual({ allowed: false, reason: "PROFILE_IDENTIFIER_MISMATCH" });
	});

	it("accepts a vanity redirect when the stable member recipient matches", () => {
		expect(
			verifyFreshLinkedInIdentity(
				target(
					"https://www.linkedin.com/in/ACoAAE-rbowBiknsv-ybR6thiDdghiJbVo8UApk",
					"ACoAAE-rbowBiknsv-ybR6thiDdghiJbVo8UApk",
					"Adam Worth",
				),
				{
					...baseObserved,
					profileUrl: "https://www.linkedin.com/in/adam-worth-/",
					profileIdentifier: "adam-worth-",
					displayName: "Adam Worth",
					conversationParticipantIdentifier:
						"ACoAAE-rbowBiknsv-ybR6thiDdghiJbVo8UApk",
				},
			),
		).toEqual({ allowed: true });
		expect(
			verifyFreshLinkedInIdentity(
				target(
					"https://www.linkedin.com/in/ACoAAE-rbowBiknsv-ybR6thiDdghiJbVo8UApk",
					"ACoAAE-rbowBiknsv-ybR6thiDdghiJbVo8UApk",
					"Adam Worth",
				),
				{
					...baseObserved,
					profileUrl: "https://www.linkedin.com/in/adam-worth-/",
					profileIdentifier: "adam-worth-",
					displayName: "Adam Worth",
					conversationParticipantIdentifier: "ACoDifferentMember",
				},
			),
		).toEqual({ allowed: false, reason: "PROFILE_URL_MISMATCH" });
	});

	it("fails closed for unresolved or foreign profile URLs", () => {
		expect(
			verifyFreshLinkedInIdentity(
				target("https://linkedin.com/in/ada-lovelace", "ada-lovelace"),
				{ ...baseObserved, profileUrl: "https://example.com/in/ada-lovelace" },
			),
		).toEqual({ allowed: false, reason: "PROFILE_URL_MISMATCH" });
	});

	it("accepts a full thread URL when the live profile compose target proves the member", () => {
		const targetValue = {
			...target(
				"https://www.linkedin.com/in/ACoAADRv2f4Bp6D9mSlzqWWbwuemI9ftAWJkSDk",
				"linkedin.com/in/acoaadrv2f4bp6d9mslzqwwbwuemi9ftawjksdk",
			),
			externalConversationKey:
				"https://www.linkedin.com/messaging/thread/2-thread-key/",
		};
		expect(
			verifyFreshLinkedInIdentity(targetValue, {
				resolution: "RESOLVED",
				profileUrl:
					"https://www.linkedin.com/in/ACoAADRv2f4Bp6D9mSlzqWWbwuemI9ftAWJkSDk",
				profileIdentifier: "ACoAADRv2f4Bp6D9mSlzqWWbwuemI9ftAWJkSDk",
				displayName: "Ada Lovelace",
				conversationParticipantIdentifier:
					"ACoAADRv2f4Bp6D9mSlzqWWbwuemI9ftAWJkSDk",
			}),
		).toEqual({ allowed: true });
		expect(
			linkedInConversationIdentityMatches(targetValue, {
				externalConversationKey: "/messaging/thread/2-thread-key/",
				conversationParticipantIdentifier: null,
			}),
		).toBe(true);
	});

	it("rejects a different conversation member and missing conversation proof", () => {
		const targetValue = {
			profileUrl:
				"https://www.linkedin.com/in/ACoAADRv2f4Bp6D9mSlzqWWbwuemI9ftAWJkSDk",
			externalConversationKey:
				"https://www.linkedin.com/messaging/thread/2-thread-key/",
		};
		expect(
			linkedInConversationIdentityMatches(targetValue, {
				externalConversationKey: null,
				conversationParticipantIdentifier: "ACoDifferentMember",
			}),
		).toBe(false);
		expect(
			linkedInConversationIdentityMatches(targetValue, {
				externalConversationKey: null,
				conversationParticipantIdentifier: null,
			}),
		).toBe(false);
	});

	it("defers stored conversation-key verification until the target composer resolves", () => {
		const messageAction = {
			jobId: "message-job",
			action: "MESSAGE" as const,
			browserSessionKey: "worker",
			target: {
				...target("https://www.linkedin.com/in/ada-lovelace/", "ada-lovelace"),
				externalConversationKey: "2-stored-thread",
			},
		};
		const profileObservation = {
			...baseObserved,
			relationshipState: "CONNECTED" as const,
			externalConversationKey: null,
			conversationParticipantIdentifier: null,
		};

		expect(
			verifyLinkedInActionState(messageAction, profileObservation),
		).toEqual({
			allowed: true,
		});
		expect(
			verifyFreshLinkedInIdentity(messageAction.target, profileObservation),
		).toEqual({
			allowed: false,
			reason: "EXTERNAL_CONVERSATION_MISMATCH",
		});
	});

	it("resolves an exact compose overlay recipient and embedded conversation key", () => {
		const evidence = resolveLinkedInComposeConversationEvidence(
			"https://www.linkedin.com/messaging/compose/?profileUrn=urn%3Ali%3Afsd_profile%3AACoAADRv2f4Bp6D9mSlzqWWbwuemI9ftAWJkSDk&recipient=ACoAADRv2f4Bp6D9mSlzqWWbwuemI9ftAWJkSDk&interop=msgOverlay",
			[
				"urn:li:msg_message:(urn:li:fsd_profile:ACoAAGzrC2MBqydOpj5W5VAtOi9Dtxk8FVwfmLU,2-MTc4OTcyMDY1NzAzN2I1MTUzMy0xMDAmMWE0YzMzYTgtZjNhNC00MmUwLWI0MDUtZWU1ZWRiYjIxOGRlXzEwMA==)",
			],
			1,
		);
		expect(evidence).toEqual({
			status: "RESOLVED",
			participantIdentifier: "ACoAADRv2f4Bp6D9mSlzqWWbwuemI9ftAWJkSDk",
			externalConversationKey:
				"2-MWE0YzMzYTgtZjNhNC00MmUwLWI0MDUtZWU1ZWRiYjIxOGRlXzEwMA==",
		});
	});

	it("resolves a compose overlay with exact member proof when no thread key is exposed", () => {
		expect(
			resolveLinkedInComposeConversationEvidence(
				"https://www.linkedin.com/messaging/compose/?profileUrn=urn%3Ali%3Afsd_profile%3AACoAADRv2f4Bp6D9mSlzqWWbwuemI9ftAWJkSDk&recipient=ACoAADRv2f4Bp6D9mSlzqWWbwuemI9ftAWJkSDk",
				[],
				1,
			),
		).toEqual({
			status: "RESOLVED",
			participantIdentifier: "ACoAADRv2f4Bp6D9mSlzqWWbwuemI9ftAWJkSDk",
			externalConversationKey: null,
		});
	});

	it("fails closed for wrong, missing, or conflicting compose identity evidence", () => {
		const url =
			"https://www.linkedin.com/messaging/compose/?profileUrn=urn%3Ali%3Afsd_profile%3AACoAADRv2f4Bp6D9mSlzqWWbwuemI9ftAWJkSDk&recipient=ACoAADRv2f4Bp6D9mSlzqWWbwuemI9ftAWJkSDk";
		const event =
			"urn:li:msg_message:(urn:li:fsd_profile:sender,2-MTIzLTEmdGhyZWFkLWtleQ==)";
		expect(resolveLinkedInComposeConversationEvidence(url, [], 0).status).toBe(
			"AMBIGUOUS",
		);
		expect(
			resolveLinkedInComposeConversationEvidence(
				url.replace(/recipient=[^&]+/, "recipient=ACoDifferentMember"),
				[],
				1,
			).status,
		).toBe("AMBIGUOUS");
		expect(
			resolveLinkedInComposeConversationEvidence(
				url,
				[event, event.replace("dGhyZWFkLWtleQ", "b3RoZXItdGhyZWFk")],
				1,
			).status,
		).toBe("AMBIGUOUS");
	});

	it("rejects a mismatched observed thread even when the member matches", () => {
		expect(
			linkedInConversationIdentityMatches(
				{
					profileUrl: "https://www.linkedin.com/in/ACoMember",
					externalConversationKey:
						"https://www.linkedin.com/messaging/thread/2-stored-thread/",
				},
				{
					externalConversationKey: "2-other-thread",
					conversationParticipantIdentifier: "ACoMember",
				},
			),
		).toBe(false);
	});

	it("blocks a first message when the live browser exposes an existing thread", () => {
		expect(
			firstMessageBrowserStateAllowsSend(
				{ expectNoExistingConversation: true },
				{ externalMessageKey: "message-1" },
			),
		).toBe(false);
		expect(
			firstMessageBrowserStateAllowsSend(
				{ expectNoExistingConversation: true },
				{ externalMessageKey: null },
			),
		).toBe(true);
		expect(
			firstMessageBrowserStateAllowsSend(
				{ expectNoExistingConversation: false },
				{ externalMessageKey: "message-1" },
			),
		).toBe(true);
	});

	it("accepts deterministic benign display-name variations", () => {
		expect(
			verifyFreshLinkedInIdentity(
				target(
					"https://www.linkedin.com/in/jop-knoester-365688104/",
					"linkedin.com/in/jop-knoester-365688104",
					"Jop Knoester",
				),
				{
					...baseObserved,
					profileUrl: "https://www.linkedin.com/in/jop-knoester-365688104/",
					profileIdentifier: "jop-knoester-365688104",
					displayName: "Jop Knoester",
				},
			),
		).toEqual({ allowed: true });
		expect(linkedInDisplayNamesMatch("Jop Knoester", "Jop Knoester")).toBe(
			true,
		);
		expect(linkedInDisplayNamesMatch("Jop Knoester", "jop knoester")).toBe(
			true,
		);
		expect(linkedInDisplayNamesMatch("Rene Vonk", "René Vonk")).toBe(true);
		expect(
			linkedInDisplayNamesMatch("Jop Alexander Knoester", "Jop A. Knoester"),
		).toBe(true);
		expect(linkedInDisplayNamesMatch("Jop Knoester", "  Jop,  Knoester ")).toBe(
			true,
		);
		expect(
			linkedInDisplayNamesMatch("Dr. Jop Knoester Jr", "Jop Knoester"),
		).toBe(true);
	});

	it("rejects materially different display names", () => {
		expect(linkedInDisplayNamesMatch("Jop Knoester", "Jop Koster")).toBe(false);
		expect(linkedInDisplayNamesMatch("Jop Knoester", "Job Knoester")).toBe(
			false,
		);
		expect(
			linkedInDisplayNamesMatch(
				"Jop Knoester",
				"Jop Knoester Different Agency",
			),
		).toBe(false);
		expect(
			verifyFreshLinkedInIdentity(
				target("https://linkedin.com/in/ada-lovelace", "ada-lovelace"),
				{ ...baseObserved, displayName: null },
			),
		).toEqual({ allowed: false, reason: "DISPLAY_NAME_MISMATCH" });
		expect(
			verifyFreshLinkedInIdentity(
				target(
					"https://linkedin.com/in/ada-lovelace",
					"ada-lovelace",
					"Ada Lovelace",
				),
				{
					...baseObserved,
					profileUrl: "https://linkedin.com/in/grace-hopper",
					profileIdentifier: "grace-hopper",
					displayName: "Ada Lovelace",
				},
			),
		).toEqual({ allowed: false, reason: "PROFILE_URL_MISMATCH" });
		expect(
			verifyFreshLinkedInIdentity(
				target(
					"https://linkedin.com/in/ada-lovelace",
					"ada-lovelace",
					"Ada Lovelace",
				),
				{ ...baseObserved, displayName: "Ada Lovelace Different Agency" },
			),
		).toEqual({ allowed: false, reason: "DISPLAY_NAME_MISMATCH" });
	});
});
