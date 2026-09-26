import { describe, expect, it } from "bun:test";
import {
	type LinkedInMessageComposerSnapshot,
	type LinkedInMessageComposerSurface,
	linkedInMessageControlConversationKey,
	linkedInMessageControlRecipientIdentifier,
	resolveLinkedInMessageComposer,
} from "../src/linkedin/message-composer-resolver";

const recipient = "ACoAAGijsVerified";
const otherRecipient = "ACoAOtherVerified";

function editor(index = 0, visible = true) {
	return {
		index,
		tagName: "DIV",
		role: "textbox",
		ariaLabel: "Write a message…",
		name: null,
		placeholder: null,
		text: "",
		contentEditable: true,
		visible,
		connected: true,
		disabled: false,
	};
}

function sendControl(index = 0, visible = true) {
	return {
		index,
		tagName: "BUTTON",
		role: null,
		ariaLabel: null,
		name: null,
		placeholder: null,
		text: "Send",
		contentEditable: false,
		visible,
		connected: true,
		disabled: false,
	};
}

function snapshot(
	overrides: Partial<LinkedInMessageComposerSurface> = {},
): LinkedInMessageComposerSnapshot {
	const base: LinkedInMessageComposerSurface = {
		index: 0,
		kind: "PROFILE_COMPOSE",
		recipientIdentifier: recipient,
		externalConversationKey: null,
		recipientCount: 1,
		visible: true,
		connected: true,
		editors: [editor()],
		sendControls: [sendControl()],
	};
	return {
		url: "https://www.linkedin.com/messaging/compose/?recipient=target",
		surfaces: [{ ...base, ...overrides }],
	};
}

describe("LinkedIn message composer resolver", () => {
	it("resolves the current profile-triggered compose surface", () => {
		expect(
			resolveLinkedInMessageComposer(snapshot(), {
				expectedRecipientIdentifier: recipient,
			}),
		).toEqual({
			status: "FOUND",
			surfaceIndex: 0,
			editorIndex: 0,
			sendControlIndex: 0,
			recipientIdentifier: recipient,
			externalConversationKey: null,
		});
	});

	it("resolves a full messaging thread by exact conversation key", () => {
		const result = resolveLinkedInMessageComposer(
			snapshot({
				kind: "THREAD",
				recipientIdentifier: null,
				externalConversationKey: "thread-42",
			}),
			{ expectedExternalConversationKey: "thread-42" },
		);
		expect(result.status).toBe("FOUND");
	});

	it("resolves a compose overlay with exact recipient evidence", () => {
		const result = resolveLinkedInMessageComposer(
			snapshot({ kind: "COMPOSE_OVERLAY" }),
			{ expectedRecipientIdentifier: recipient },
		);
		expect(result.status).toBe("FOUND");
	});

	it("fails closed for an exact recipient mismatch", () => {
		expect(
			resolveLinkedInMessageComposer(snapshot(), {
				expectedRecipientIdentifier: otherRecipient,
			}),
		).toEqual({ status: "NONE" });
	});

	it("requires one visible editor and ignores hidden duplicates", () => {
		const result = resolveLinkedInMessageComposer(
			snapshot({ editors: [editor(0), editor(1, false)] }),
			{ expectedRecipientIdentifier: recipient },
		);
		expect(result.status).toBe("FOUND");
	});

	it("fails closed for multiple visible editors", () => {
		expect(
			resolveLinkedInMessageComposer(
				snapshot({ editors: [editor(0), editor(1)] }),
				{ expectedRecipientIdentifier: recipient },
			),
		).toEqual({ status: "AMBIGUOUS" });
	});

	it("fails closed for conflicting visible target surfaces", () => {
		const base = snapshot();
		const firstSurface = base.surfaces[0];
		if (!firstSurface) throw new Error("TEST_SURFACE_MISSING");
		expect(
			resolveLinkedInMessageComposer(
				{
					...base,
					surfaces: [...base.surfaces, { ...firstSurface, index: 1 }],
				},
				{ expectedRecipientIdentifier: recipient },
			),
		).toEqual({ status: "AMBIGUOUS" });
	});

	it("fails closed when the control is detached or disabled", () => {
		const result = resolveLinkedInMessageComposer(
			snapshot({
				editors: [{ ...editor(), connected: false }],
				sendControls: [{ ...sendControl(), disabled: true }],
			}),
			{ expectedRecipientIdentifier: recipient },
		);
		expect(result.status).toBe("AMBIGUOUS");
	});

	it("supports a delayed mount without broadening the target", () => {
		const states = [
			snapshot({ visible: false }),
			{ url: "https://www.linkedin.com/messaging/compose/", surfaces: [] },
			snapshot(),
		];
		const result = states
			.map((state) =>
				resolveLinkedInMessageComposer(state, {
					expectedRecipientIdentifier: recipient,
				}),
			)
			.find((value) => value.status !== "NONE");
		expect(result?.status).toBe("FOUND");
	});

	it("extracts exact recipient and thread evidence from controls", () => {
		const composeHref = `https://www.linkedin.com/messaging/compose/?profileUrn=urn%3Ali%3Afsd_profile%3A${recipient}&recipient=${recipient}`;
		expect(linkedInMessageControlRecipientIdentifier(composeHref)).toBe(
			recipient,
		);
		expect(
			linkedInMessageControlRecipientIdentifier(
				`https://www.linkedin.com/messaging/compose/?recipient=${otherRecipient}&profileUrn=urn%3Ali%3Afsd_profile%3A${recipient}`,
			),
		).toBeNull();
		expect(
			linkedInMessageControlConversationKey(
				"https://www.linkedin.com/messaging/thread/2-thread-42/",
			),
		).toBe("2-thread-42");
	});
});
