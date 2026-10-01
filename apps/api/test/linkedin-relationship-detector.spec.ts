import { describe, expect, it } from "bun:test";
import { verifyFreshLinkedInIdentity } from "@crm/db/linkedin-browser-adapter";
import {
	detectLinkedInRelationshipState,
	resolveLinkedInProfileDisplayName,
} from "../src/linkedin/cdp-linkedin-browser-adapter";
import { resolveLinkedInRelationshipControl } from "../src/linkedin/relationship-control-resolver";

const base = {
	profileIdentifier: "gijs-van-der-velden-856a42128",
	displayName: "Gijs van der Velden",
};

function control(
	text: string,
	options: Partial<{
		tagName: string;
		role: string | null;
		ariaLabel: string | null;
		href: string | null;
		targetProfile: boolean;
		visible: boolean;
		connected: boolean;
		elementIndex: number;
	}> = {},
) {
	return {
		elementIndex: options.elementIndex ?? 0,
		tagName: options.tagName ?? "BUTTON",
		role: options.role ?? null,
		text,
		ariaLabel: options.ariaLabel ?? null,
		href: options.href ?? null,
		targetProfile: options.targetProfile ?? true,
		visible: options.visible ?? true,
		connected: options.connected ?? true,
	};
}

describe("LinkedIn relationship control detection", () => {
	it("skips the LinkedIn notifications heading and resolves the profile name", () => {
		expect(
			resolveLinkedInProfileDisplayName([
				{ text: "0 notifications", visible: true, excluded: false },
				{ text: "Loading", visible: false, excluded: false },
				{ text: "Other profile", visible: true, excluded: true },
				{ text: "Yasin Özpinar", visible: true, excluded: false },
			]),
		).toBe("Yasin Özpinar");
	});

	it("does not treat a notification heading as a verified profile name", () => {
		expect(
			resolveLinkedInProfileDisplayName([
				{ text: "0 notifications total", visible: true, excluded: false },
			]),
		).toBeNull();
	});

	it("ignores LinkedIn's premium recommendation heading beside the profile name", () => {
		expect(
			resolveLinkedInProfileDisplayName([
				{ text: "0 notifications", visible: true, excluded: false },
				{ text: "Ster Hassan", visible: true, excluded: false },
				{ text: "Explore Premium profiles", visible: true, excluded: false },
			]),
		).toBe("Ster Hassan");
	});

	it("does not treat the premium recommendation heading as a profile identity", () => {
		expect(
			resolveLinkedInProfileDisplayName([
				{ text: "Explore Premium profiles", visible: true, excluded: false },
			]),
		).toBeNull();
	});

	it("fails closed when multiple visible headings could identify the profile", () => {
		expect(
			resolveLinkedInProfileDisplayName([
				{ text: "Yasin Özpinar", visible: true, excluded: false },
				{ text: "Alex Veremeev", visible: true, excluded: false },
			]),
		).toBeNull();
	});

	it("detects Gijs's Dutch ordinary-anchor Connect control", () => {
		expect(
			detectLinkedInRelationshipState({
				...base,
				controls: [
					control("Connectie maken", {
						tagName: "A",
						ariaLabel: "Connectieverzoek verzenden naar Gijs van der Velden",
						href: "/preload/custom-invite/?vanityName=gijs-van-der-velden-856a42128",
					}),
				],
			}),
		).toEqual({
			relationshipState: "CONNECT",
			pendingInvitationState: "UNKNOWN",
		});
	});

	it("detects Salvador's Dutch ordinary-anchor Connect control", () => {
		expect(
			detectLinkedInRelationshipState({
				profileIdentifier: "salvador-de-miranda-8a8a3833",
				displayName: "Salvador de Miranda",
				controls: [
					control("Connectie maken", {
						tagName: "A",
						ariaLabel: "Connectieverzoek verzenden naar Salvador de Miranda",
						href: "/preload/custom-invite/?vanityName=salvador-de-miranda-8a8a3833",
					}),
				],
			}),
		).toEqual({
			relationshipState: "CONNECT",
			pendingInvitationState: "UNKNOWN",
		});
	});

	it("detects English Connect buttons and anchors", () => {
		for (const candidate of [
			control("Connect"),
			control("Connect", {
				tagName: "A",
				role: "button",
				href: null,
				ariaLabel: "Connect",
			}),
			control("Connect", {
				tagName: "A",
				href: "/preload/custom-invite/?vanityName=gijs-van-der-velden-856a42128",
			}),
		]) {
			expect(
				detectLinkedInRelationshipState({ ...base, controls: [candidate] }),
			).toEqual({
				relationshipState: "CONNECT",
				pendingInvitationState: "UNKNOWN",
			});
		}
	});

	it("shares the exact resolver between detection and execution", () => {
		const connect = control("Connectie maken", {
			tagName: "A",
			ariaLabel: "Connectieverzoek verzenden naar Gijs van der Velden",
			href: "/preload/custom-invite/?vanityName=gijs-van-der-velden-856a42128",
		});
		const resolved = resolveLinkedInRelationshipControl({
			action: "CONNECT",
			...base,
			controls: [connect],
		});
		expect(resolved).toEqual({ status: "FOUND", control: connect });
		expect(
			detectLinkedInRelationshipState({ ...base, controls: [connect] }),
		).toEqual({
			relationshipState: "CONNECT",
			pendingInvitationState: "UNKNOWN",
		});
	});

	it("ignores hidden duplicate Connect controls", () => {
		expect(
			resolveLinkedInRelationshipControl({
				action: "CONNECT",
				...base,
				controls: [
					control("Connectie maken", {
						tagName: "A",
						href: "/preload/custom-invite/?vanityName=gijs-van-der-velden-856a42128",
					}),
					control("Connectie maken", {
						tagName: "A",
						href: "/preload/custom-invite/?vanityName=gijs-van-der-velden-856a42128",
						visible: false,
						elementIndex: 1,
					}),
				],
			}),
		).toMatchObject({ status: "FOUND" });
	});

	it("fails closed for conflicting visible Connect controls", () => {
		const controls = [
			control("Connect", {
				ariaLabel: "Connect to Gijs van der Velden",
				elementIndex: 0,
			}),
			control("Connectie maken", {
				tagName: "A",
				href: "/preload/custom-invite/?vanityName=gijs-van-der-velden-856a42128",
				elementIndex: 1,
			}),
		];
		expect(
			resolveLinkedInRelationshipControl({
				action: "CONNECT",
				...base,
				controls,
			}),
		).toEqual({ status: "AMBIGUOUS" });
		expect(detectLinkedInRelationshipState({ ...base, controls })).toEqual({
			relationshipState: "AMBIGUOUS",
			pendingInvitationState: "UNKNOWN",
		});
	});

	it("fails closed for detached or hidden controls", () => {
		for (const options of [{ connected: false }, { visible: false }]) {
			expect(
				resolveLinkedInRelationshipControl({
					action: "CONNECT",
					...base,
					controls: [
						control("Connectie maken", {
							tagName: "A",
							href: "/preload/custom-invite/?vanityName=gijs-van-der-velden-856a42128",
							...options,
						}),
					],
				}),
			).toEqual({ status: "NONE" });
		}
	});

	it("rejects a wrong vanityName and unrelated generic Connect control", () => {
		expect(
			detectLinkedInRelationshipState({
				...base,
				controls: [
					control("Connectie maken", {
						tagName: "A",
						href: "/preload/custom-invite/?vanityName=other-person",
					}),
				],
			}),
		).toEqual({
			relationshipState: "AMBIGUOUS",
			pendingInvitationState: "UNKNOWN",
		});
		expect(
			detectLinkedInRelationshipState({
				...base,
				controls: [control("Connect", { targetProfile: false })],
			}),
		).toEqual({
			relationshipState: "AMBIGUOUS",
			pendingInvitationState: "UNKNOWN",
		});
	});

	it("rejects a target-specific aria label for the wrong person", () => {
		expect(
			resolveLinkedInRelationshipControl({
				action: "CONNECT",
				...base,
				controls: [
					control("Connect", {
						ariaLabel: "Connect to another person",
					}),
				],
			}),
		).toEqual({ status: "NONE" });
	});

	it("detects English and Dutch pending invitations", () => {
		for (const label of ["Pending", "Uitnodiging verzonden"]) {
			expect(
				detectLinkedInRelationshipState({
					...base,
					controls: [control(label)],
				}),
			).toEqual({
				relationshipState: "PENDING",
				pendingInvitationState: "SENT",
			});
		}
	});

	it("detects Message and Bericht as connected state", () => {
		for (const label of ["Message", "Bericht"]) {
			expect(
				detectLinkedInRelationshipState({
					...base,
					controls: [
						control(label, {
							tagName: "A",
							href: "/messaging/compose/?recipient=target",
						}),
					],
				}),
			).toEqual({
				relationshipState: "CONNECTED",
				pendingInvitationState: "NONE",
			});
		}
	});

	it("uses the target profile compose link when Message text is split", () => {
		expect(
			resolveLinkedInRelationshipControl({
				action: "MESSAGE",
				...base,
				controls: [
					control("Me age", {
						href: "/messaging/compose/?profileUrn=urn%3Ali%3Afsd_profile%3Atarget&recipient=target",
					}),
				],
			}),
		).toMatchObject({ status: "FOUND" });
	});

	it("rejects message links outside the verified profile section", () => {
		expect(
			resolveLinkedInRelationshipControl({
				action: "MESSAGE",
				...base,
				controls: [
					control("Me age", {
						targetProfile: false,
						href: "/messaging/compose/?recipient=target",
					}),
				],
			}),
		).toEqual({ status: "NONE" });
	});

	it("rejects message controls labelled for another profile", () => {
		expect(
			resolveLinkedInRelationshipControl({
				action: "MESSAGE",
				...base,
				controls: [control("Message", { ariaLabel: "Message Another Person" })],
			}),
		).toEqual({ status: "NONE" });
	});

	it("does not treat Follow as Connect and lets Connect win", () => {
		expect(
			detectLinkedInRelationshipState({
				...base,
				controls: [control("Volgen")],
			}),
		).toEqual({
			relationshipState: "AMBIGUOUS",
			pendingInvitationState: "UNKNOWN",
		});
		expect(
			detectLinkedInRelationshipState({
				...base,
				controls: [
					control("Volgen"),
					control("Connectie maken", {
						tagName: "A",
						href: "/preload/custom-invite/?vanityName=gijs-van-der-velden-856a42128",
					}),
				],
			}),
		).toEqual({
			relationshipState: "CONNECT",
			pendingInvitationState: "UNKNOWN",
		});
	});

	it("fails closed for ambiguous controls", () => {
		expect(
			detectLinkedInRelationshipState({
				...base,
				controls: [control("Meer")],
			}),
		).toEqual({
			relationshipState: "AMBIGUOUS",
			pendingInvitationState: "UNKNOWN",
		});
	});

	it("does not override an exact identity mismatch", () => {
		const detection = detectLinkedInRelationshipState({
			...base,
			controls: [
				control("Connectie maken", {
					tagName: "A",
					href: "/preload/custom-invite/?vanityName=gijs-van-der-velden-856a42128",
				}),
			],
		});
		expect(detection.relationshipState).toBe("CONNECT");
		expect(
			verifyFreshLinkedInIdentity(
				{
					contactId: "contact-1",
					routeId: "route-1",
					profileUrl:
						"https://www.linkedin.com/in/gijs-van-der-velden-856a42128/",
					profileIdentifier: "gijs-van-der-velden-856a42128",
					displayName: "Gijs van der Velden",
				},
				{
					resolution: "RESOLVED",
					profileUrl: "https://www.linkedin.com/in/other-person/",
					profileIdentifier: "other-person",
					displayName: "Gijs van der Velden",
				},
			),
		).toEqual({ allowed: false, reason: "PROFILE_URL_MISMATCH" });
	});
});
