import { describe, expect, it } from "bun:test";
import {
	type LinkedInConnectionRequestModal,
	type LinkedInConnectionRequestModalAction,
	type LinkedInConnectionRequestModalControl,
	resolveLinkedInConnectionRequestModalControl,
} from "../src/linkedin/connection-request-modal-resolver";

const target = {
	expectedProfileSlug: "salvador-de-miranda-8a8a3833",
	currentProfileSlug: "salvador-de-miranda-8a8a3833",
	expectedDisplayName: "Salvador de Miranda",
};

function control(
	text: string,
	options: Partial<LinkedInConnectionRequestModalControl> = {},
): LinkedInConnectionRequestModalControl {
	return {
		elementIndex: options.elementIndex ?? 0,
		tagName: options.tagName ?? "BUTTON",
		role: options.role ?? null,
		text,
		ariaLabel: options.ariaLabel ?? text,
		closeControl: options.closeControl ?? false,
		visible: options.visible ?? true,
		connected: options.connected ?? true,
		disabled: options.disabled ?? false,
	};
}

function inviteModal(
	targetName = "Salvador de Miranda",
	controls: LinkedInConnectionRequestModalControl[] = [
		control("Add a note"),
		control("Send without a note", { elementIndex: 1 }),
		control("", {
			elementIndex: 2,
			ariaLabel: "Dismiss",
			closeControl: true,
		}),
	],
	options: Partial<LinkedInConnectionRequestModal> = {},
): LinkedInConnectionRequestModal {
	return {
		elementIndex: 0,
		role: "dialog",
		dataTestModal: true,
		labelledBy: "send-invite-modal",
		text: `Add a note to your invitation? Personalize your invitation to ${targetName} by adding a note.`,
		targetNames: [targetName],
		visible: true,
		connected: true,
		controls,
		...options,
	};
}

function resolve(
	action: LinkedInConnectionRequestModalAction,
	modals: LinkedInConnectionRequestModal[],
	profile = target.currentProfileSlug,
) {
	return resolveLinkedInConnectionRequestModalControl({
		action,
		...target,
		currentProfileSlug: profile,
		modals,
	});
}

describe("LinkedIn connection-request invite modal controls", () => {
	it("resolves the exact English Send without a note control", () => {
		expect(resolve("SEND_WITHOUT_NOTE", [inviteModal()])).toMatchObject({
			status: "FOUND",
			control: {
				text: "Send without a note",
				ariaLabel: "Send without a note",
			},
		});
	});

	it("resolves Add a note separately from the final send control", () => {
		expect(resolve("ADD_NOTE", [inviteModal()])).toMatchObject({
			status: "FOUND",
			control: { text: "Add a note", ariaLabel: "Add a note" },
		});
	});

	it("requires the intended modal target and current profile slug", () => {
		expect(resolve("SEND_WITHOUT_NOTE", [inviteModal()]).status).toBe("FOUND");
		expect(
			resolve("SEND_WITHOUT_NOTE", [inviteModal("Another person")]),
		).toEqual({ status: "AMBIGUOUS" });
		expect(
			resolve("SEND_WITHOUT_NOTE", [inviteModal()], "different-profile"),
		).toEqual({ status: "AMBIGUOUS" });
	});

	it("ignores hidden duplicate controls but rejects conflicting visible duplicates", () => {
		const visible = control("Send without a note");
		const hidden = control("Send without a note", {
			elementIndex: 1,
			visible: false,
		});
		expect(
			resolve("SEND_WITHOUT_NOTE", [inviteModal(undefined, [visible, hidden])]),
		).toMatchObject({ status: "FOUND" });
		expect(
			resolve("SEND_WITHOUT_NOTE", [
				inviteModal(undefined, [
					visible,
					control("Send without a note", { elementIndex: 1 }),
				]),
			]),
		).toEqual({ status: "AMBIGUOUS" });
	});

	it("fails closed for multiple or structurally ambiguous invite modals", () => {
		expect(
			resolve("SEND_WITHOUT_NOTE", [inviteModal(), inviteModal()]),
		).toEqual({ status: "AMBIGUOUS" });
		expect(
			resolve("SEND_WITHOUT_NOTE", [
				inviteModal("Salvador de Miranda", undefined, {
					labelledBy: "other-dialog",
				}),
			]),
		).toEqual({ status: "AMBIGUOUS" });
	});

	it("does not click when the modal disappears before final resolution", () => {
		expect(resolve("SEND_WITHOUT_NOTE", [])).toEqual({ status: "NONE" });
	});

	it("does not confuse Add a note, Dismiss, or unrelated controls with Send", () => {
		expect(
			resolve("SEND_WITHOUT_NOTE", [
				inviteModal(undefined, [
					control("Add a note"),
					control("", {
						elementIndex: 1,
						ariaLabel: "Dismiss",
						closeControl: true,
					}),
					control("Send", { elementIndex: 2 }),
				]),
			]),
		).toEqual({ status: "NONE" });
		expect(resolve("DISMISS", [inviteModal()])).toMatchObject({
			status: "FOUND",
			control: { ariaLabel: "Dismiss", closeControl: true },
		});
	});

	it("fails closed for hidden, detached, disabled, and malformed final controls", () => {
		for (const state of [
			{ visible: false },
			{ connected: false },
			{ disabled: true },
			{ ariaLabel: "Send" },
		]) {
			expect(
				resolve("SEND_WITHOUT_NOTE", [
					inviteModal(undefined, [control("Send without a note", state)]),
				]),
			).toEqual({ status: "NONE" });
		}
	});
});
