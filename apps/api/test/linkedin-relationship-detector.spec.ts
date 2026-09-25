import { describe, expect, it } from "bun:test";
import { verifyFreshLinkedInIdentity } from "@crm/db/linkedin-browser-adapter";
import { detectLinkedInRelationshipState } from "../src/linkedin/cdp-linkedin-browser-adapter";

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
	}> = {},
) {
	return {
		tagName: options.tagName ?? "BUTTON",
		role: options.role ?? null,
		text,
		ariaLabel: options.ariaLabel ?? null,
		href: options.href ?? null,
		targetProfile: options.targetProfile ?? true,
	};
}

describe("LinkedIn relationship control detection", () => {
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
