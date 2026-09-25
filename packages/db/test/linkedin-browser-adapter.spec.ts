import { describe, expect, it } from "bun:test";
import {
	canonicalLinkedInProfileIdentity,
	canonicalLinkedInProfileUrl,
	linkedInDisplayNamesMatch,
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
