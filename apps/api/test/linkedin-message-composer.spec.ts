import { describe, expect, it } from "bun:test";
import { firstMessageBrowserStateAllowsSend } from "@crm/db/linkedin-browser-adapter";
import { linkedinMessageExecutionUrl } from "../src/linkedin/cdp-linkedin-browser-adapter";
import {
	type LinkedInMessageComposerSnapshot,
	type LinkedInMessageComposerSurface,
	linkedInMessageComposerControlReady,
	linkedInMessageControlConversationKey,
	linkedInMessageControlRecipientIdentifier,
	resolveLinkedInMessageComposer,
	summarizeLinkedInMessageComposerSnapshot,
	waitForStableLinkedInMessageComposer,
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

function sendControl(index = 0, visible = true, disabled = false) {
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
		disabled,
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
		externalMessageKey: null,
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
	it("waits beyond the old three-second window for editor hydration", async () => {
		let time = 0;
		const result = await waitForStableLinkedInMessageComposer(
			async () =>
				time < 5000
					? { status: "NONE" }
					: resolveLinkedInMessageComposer(snapshot(), {
							expectedRecipientIdentifier: recipient,
						}),
			{
				now: () => time,
				wait: async (milliseconds) => {
					time += milliseconds;
				},
			},
		);
		expect(result.status).toBe("FOUND");
		expect(result.elapsedMs).toBe(5250);
	});

	it("treats a target editor that is still loading as unavailable without approving it", () => {
		for (const editors of [
			[],
			[{ ...editor(), disabled: true }],
			[editor(0, false)],
		]) {
			expect(
				resolveLinkedInMessageComposer(snapshot({ editors }), {
					expectedRecipientIdentifier: recipient,
				}),
			).toEqual({ status: "LOADING" });
		}
	});

	it("waits for the disabled editor to become usable", async () => {
		let time = 0;
		const result = await waitForStableLinkedInMessageComposer(
			async () =>
				resolveLinkedInMessageComposer(
					snapshot({ editors: [{ ...editor(), disabled: time < 2000 }] }),
					{ expectedRecipientIdentifier: recipient },
				),
			{
				now: () => time,
				wait: async (milliseconds) => {
					time += milliseconds;
				},
			},
		);
		expect(result.status).toBe("FOUND");
		expect(result.elapsedMs).toBe(2250);
	});

	it("never accepts a single ready observation at the deadline", async () => {
		let time = 0;
		const result = await waitForStableLinkedInMessageComposer(
			async () =>
				time === 750
					? resolveLinkedInMessageComposer(snapshot(), {
							expectedRecipientIdentifier: recipient,
						})
					: { status: "NONE" },
			{
				timeoutMs: 1000,
				now: () => time,
				wait: async (milliseconds) => {
					time += milliseconds;
				},
			},
		);
		expect(result.status).toBe("LOADING");
	});

	it("resets stability when the editor re-renders", async () => {
		let time = 0;
		const result = await waitForStableLinkedInMessageComposer(
			async () =>
				resolveLinkedInMessageComposer(
					snapshot({ editors: [editor(time === 0 ? 0 : 1)] }),
					{ expectedRecipientIdentifier: recipient },
				),
			{
				now: () => time,
				wait: async (milliseconds) => {
					time += milliseconds;
				},
			},
		);
		expect(result.status).toBe("FOUND");
		expect(result.elapsedMs).toBe(500);
	});

	it("detects replacement of an editor even when its UI index is unchanged", async () => {
		let time = 0;
		const result = await waitForStableLinkedInMessageComposer(
			async () =>
				resolveLinkedInMessageComposer(
					snapshot({
						editors: [{ ...editor(), nodeIdentity: time === 0 ? 1 : 2 }],
					}),
					{ expectedRecipientIdentifier: recipient },
				),
			{
				now: () => time,
				wait: async (milliseconds) => {
					time += milliseconds;
				},
			},
		);
		expect(result.status).toBe("FOUND");
		expect(result.elapsedMs).toBe(500);
	});

	it("times out without accepting an unavailable or wrong recipient", async () => {
		for (const value of [
			snapshot({ editors: [] }),
			snapshot({ recipientIdentifier: otherRecipient }),
		]) {
			let time = 0;
			const result = await waitForStableLinkedInMessageComposer(
				async () =>
					resolveLinkedInMessageComposer(value, {
						expectedRecipientIdentifier: recipient,
					}),
				{
					timeoutMs: 1000,
					now: () => time,
					wait: async (milliseconds) => {
						time += milliseconds;
					},
				},
			);
			expect(result.status).not.toBe("FOUND");
		}
	});

	it("fails closed immediately on multiple target surfaces", async () => {
		const value = snapshot();
		const surface = value.surfaces[0];
		if (!surface) throw new Error("Missing fixture surface");
		value.surfaces.push({ ...surface, index: 1 });
		const result = await waitForStableLinkedInMessageComposer(async () =>
			resolveLinkedInMessageComposer(value, {
				expectedRecipientIdentifier: recipient,
			}),
		);
		expect(result.status).toBe("AMBIGUOUS");
		expect(result.observations).toBe(1);
	});
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
			externalMessageKey: null,
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

	it("binds an existing thread composer to both the recipient and thread key", () => {
		const result = resolveLinkedInMessageComposer(
			snapshot({
				kind: "THREAD",
				recipientIdentifier: recipient,
				externalConversationKey: "thread-42",
			}),
			{
				expectedRecipientIdentifier: recipient,
				expectedExternalConversationKey: "thread-42",
			},
		);
		expect(result.status).toBe("FOUND");
		expect(
			resolveLinkedInMessageComposer(
				snapshot({
					kind: "THREAD",
					recipientIdentifier: otherRecipient,
					externalConversationKey: "thread-42",
				}),
				{
					expectedRecipientIdentifier: recipient,
					expectedExternalConversationKey: "thread-42",
				},
			).status,
		).not.toBe("FOUND");
		expect(
			resolveLinkedInMessageComposer(
				snapshot({
					kind: "THREAD",
					recipientIdentifier: recipient,
					externalConversationKey: "thread-other",
				}),
				{
					expectedRecipientIdentifier: recipient,
					expectedExternalConversationKey: "thread-42",
				},
			).status,
		).toBe("AMBIGUOUS");
	});

	it("matches percent-encoded thread keys to their canonical key", () => {
		const result = resolveLinkedInMessageComposer(
			snapshot({
				kind: "THREAD",
				recipientIdentifier: recipient,
				externalConversationKey: "thread-42==",
			}),
			{
				expectedRecipientIdentifier: recipient,
				expectedExternalConversationKey: "thread-42%3D%3D",
			},
		);
		expect(result.status).toBe("FOUND");
	});

	it("navigates existing-conversation replies to the stored thread", () => {
		expect(
			linkedinMessageExecutionUrl(
				"https://www.linkedin.com/in/ster-hassan-147b433b0/",
				"2-NTkzYjE3MDgtODU4My00YzlkLTk2MWYtNWY5OGViYmViZjY3XzEwMA==",
			),
		).toBe(
			"https://www.linkedin.com/messaging/thread/2-NTkzYjE3MDgtODU4My00YzlkLTk2MWYtNWY5OGViYmViZjY3XzEwMA==/",
		);
		expect(
			linkedinMessageExecutionUrl(
				"https://www.linkedin.com/in/ster-hassan-147b433b0/",
				"2-thread-42%3D%3D",
			),
		).toBe("https://www.linkedin.com/messaging/thread/2-thread-42==/");
	});

	it("keeps first-message navigation on the profile when no thread is stored", () => {
		const profileUrl = "https://www.linkedin.com/in/ster-hassan-147b433b0/";
		expect(linkedinMessageExecutionUrl(profileUrl, null)).toBe(profileUrl);
	});

	it("rejects unsafe stored conversation keys", () => {
		expect(
			linkedinMessageExecutionUrl(
				"https://www.linkedin.com/in/ster-hassan-147b433b0/",
				"thread-42/other?recipient=wrong",
			),
		).toBeNull();
	});

	it("keeps exact existing threads bound to their stored conversation", () => {
		expect(
			resolveLinkedInMessageComposer(
				snapshot({
					kind: "THREAD",
					recipientIdentifier: null,
					externalConversationKey: "thread-current",
				}),
				{ expectedExternalConversationKey: "thread-current" },
			).status,
		).toBe("FOUND");
		expect(
			resolveLinkedInMessageComposer(
				snapshot({
					kind: "THREAD",
					recipientIdentifier: null,
					externalConversationKey: "thread-other",
				}),
				{ expectedExternalConversationKey: "thread-current" },
			).status,
		).toBe("NONE");
	});

	it("waits when the exact recipient surface has not hydrated the expected thread key", () => {
		expect(
			resolveLinkedInMessageComposer(snapshot(), {
				expectedRecipientIdentifier: recipient,
				expectedExternalConversationKey: "thread-42",
			}),
		).toEqual({ status: "LOADING" });
	});

	it("rejects an exact-recipient surface showing a conflicting thread key", () => {
		expect(
			resolveLinkedInMessageComposer(
				snapshot({ externalConversationKey: "thread-other" }),
				{
					expectedRecipientIdentifier: recipient,
					expectedExternalConversationKey: "thread-42",
				},
			),
		).toEqual({ status: "AMBIGUOUS" });
	});

	it("summarizes composer proof without including draft text", () => {
		const diagnostics = summarizeLinkedInMessageComposerSnapshot(
			snapshot({ editors: [{ ...editor(), text: "private draft text" }] }),
		);
		expect(diagnostics).toMatchObject({
			candidateSurfaceCount: 1,
			surfaces: [
				{
					kind: "PROFILE_COMPOSE",
					recipientIdentifier: recipient,
					recipientCount: 1,
				},
			],
		});
		expect(JSON.stringify(diagnostics)).not.toContain("private draft text");
	});

	it("resolves a compose overlay with exact recipient evidence", () => {
		const result = resolveLinkedInMessageComposer(
			snapshot({ kind: "COMPOSE_OVERLAY" }),
			{ expectedRecipientIdentifier: recipient },
		);
		expect(result.status).toBe("FOUND");
	});

	it("ignores a stale background thread when the target composer is empty", () => {
		const target = snapshot();
		const staleThread = snapshot({
			index: 1,
			kind: "THREAD",
			recipientIdentifier: null,
			externalConversationKey: "stale-thread",
			externalMessageKey: "stale-message",
		});
		const targetSurface = target.surfaces[0];
		const staleThreadSurface = staleThread.surfaces[0];
		if (!targetSurface || !staleThreadSurface)
			throw new Error("COMPOSER_SURFACE_MISSING");
		const result = resolveLinkedInMessageComposer(
			{ ...target, surfaces: [targetSurface, staleThreadSurface] },
			{ expectedRecipientIdentifier: recipient },
		);
		expect(result).toMatchObject({
			status: "FOUND",
			externalMessageKey: null,
		});
		if (result.status !== "FOUND") throw new Error("COMPOSER_NOT_FOUND");
		expect(
			firstMessageBrowserStateAllowsSend(
				{ expectNoExistingConversation: true },
				{ externalMessageKey: result.externalMessageKey },
			),
		).toBe(true);
	});

	it("exposes substantive history from the resolved target surface", () => {
		const result = resolveLinkedInMessageComposer(
			snapshot({ externalMessageKey: "target-message" }),
			{ expectedRecipientIdentifier: recipient },
		);
		expect(result).toMatchObject({
			status: "FOUND",
			externalMessageKey: "target-message",
		});
		if (result.status !== "FOUND") throw new Error("COMPOSER_NOT_FOUND");
		expect(
			firstMessageBrowserStateAllowsSend(
				{ expectNoExistingConversation: true },
				{ externalMessageKey: result.externalMessageKey },
			),
		).toBe(false);
	});

	it("keeps an empty no-note compose eligible for a first real message", () => {
		const result = resolveLinkedInMessageComposer(snapshot(), {
			expectedRecipientIdentifier: recipient,
		});
		expect(result.status).toBe("FOUND");
		expect(
			firstMessageBrowserStateAllowsSend(
				{ expectNoExistingConversation: true },
				{ externalMessageKey: null },
			),
		).toBe(true);
	});

	it("blocks a first message when a substantive thread is present", () => {
		const result = resolveLinkedInMessageComposer(
			snapshot({
				kind: "COMPOSE_OVERLAY",
				externalConversationKey: "thread-42",
			}),
			{ expectedRecipientIdentifier: recipient },
		);
		expect(result.status).toBe("FOUND");
		expect(
			firstMessageBrowserStateAllowsSend(
				{ expectNoExistingConversation: true },
				{ externalMessageKey: "message-42" },
			),
		).toBe(false);
	});

	it("resolves the Gijs profile composer before Send is enabled", () => {
		const result = resolveLinkedInMessageComposer(
			snapshot({ sendControls: [sendControl(7, true, true)] }),
			{ expectedRecipientIdentifier: recipient },
		);
		expect(result.status).toBe("FOUND");
		expect(
			linkedInMessageComposerControlReady(sendControl(7, true, true)),
		).toBe(false);
		expect(linkedInMessageComposerControlReady(sendControl(7))).toBe(true);
	});

	it("fails closed for an exact recipient mismatch", () => {
		expect(
			resolveLinkedInMessageComposer(snapshot(), {
				expectedRecipientIdentifier: otherRecipient,
			}),
		).toEqual({ status: "NONE" });
	});

	it("fails closed when recipient identity changes before send", () => {
		const initial = resolveLinkedInMessageComposer(snapshot(), {
			expectedRecipientIdentifier: recipient,
		});
		const final = resolveLinkedInMessageComposer(
			snapshot({ recipientIdentifier: otherRecipient }),
			{ expectedRecipientIdentifier: recipient },
		);
		expect(initial.status).toBe("FOUND");
		expect(final.status).toBe("NONE");
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
		expect(result.status).toBe("LOADING");
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
