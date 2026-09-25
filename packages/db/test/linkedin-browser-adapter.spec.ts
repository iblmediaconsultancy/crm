import { describe, expect, it } from "bun:test";
import {
	canonicalLinkedInProfileIdentity,
	canonicalLinkedInProfileUrl,
	verifyFreshLinkedInIdentity,
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

	it("fails closed for unresolved or foreign profile URLs", () => {
		expect(
			verifyFreshLinkedInIdentity(
				target("https://linkedin.com/in/ada-lovelace", "ada-lovelace"),
				{ ...baseObserved, profileUrl: "https://example.com/in/ada-lovelace" },
			),
		).toEqual({ allowed: false, reason: "PROFILE_URL_MISMATCH" });
	});
});
