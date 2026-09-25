export type LinkedInConnectionRequestModalAction =
	| "ADD_NOTE"
	| "SEND_WITHOUT_NOTE"
	| "DISMISS";

export type LinkedInConnectionRequestModalControl = {
	elementIndex: number;
	tagName: string;
	role: string | null;
	text: string;
	ariaLabel: string | null;
	closeControl: boolean;
	visible: boolean;
	connected: boolean;
	disabled: boolean;
};

export type LinkedInConnectionRequestModal = {
	elementIndex: number;
	role: string | null;
	dataTestModal: boolean;
	labelledBy: string | null;
	text: string;
	targetNames: string[];
	visible: boolean;
	connected: boolean;
	controls: LinkedInConnectionRequestModalControl[];
};

export type LinkedInConnectionRequestModalResolution =
	| { status: "NONE" }
	| { status: "AMBIGUOUS" }
	| {
			status: "FOUND";
			modalIndex: number;
			controlIndex: number;
			control: LinkedInConnectionRequestModalControl;
	  };

export function resolveLinkedInConnectionRequestModalControl(input: {
	action: LinkedInConnectionRequestModalAction;
	expectedProfileSlug: string;
	currentProfileSlug: string | null;
	expectedDisplayName: string | null;
	modals: LinkedInConnectionRequestModal[];
}): LinkedInConnectionRequestModalResolution {
	function normalize(value: string): string {
		return value
			.normalize("NFKC")
			.trim()
			.replace(/\s+/g, " ")
			.toLocaleLowerCase();
	}

	function normalizeSlug(value: string): string {
		return value.toLocaleLowerCase();
	}

	if (
		!input.currentProfileSlug ||
		normalizeSlug(input.currentProfileSlug) !==
			normalizeSlug(input.expectedProfileSlug)
	)
		return { status: "AMBIGUOUS" };

	const activeModals = input.modals.filter(
		(modal) =>
			modal.role === "dialog" &&
			modal.dataTestModal &&
			modal.visible &&
			modal.connected,
	);
	if (activeModals.length === 0) return { status: "NONE" };
	if (activeModals.length !== 1) return { status: "AMBIGUOUS" };
	const [modal] = activeModals;
	if (modal?.labelledBy !== "send-invite-modal") return { status: "AMBIGUOUS" };
	if (!/\binvitation\b/i.test(modal.text)) return { status: "AMBIGUOUS" };
	if (!input.expectedDisplayName) return { status: "AMBIGUOUS" };
	const expectedName = normalize(input.expectedDisplayName);
	if (
		modal.targetNames.filter((name) => normalize(name) === expectedName)
			.length !== 1
	)
		return { status: "AMBIGUOUS" };

	const controls = modal.controls
		.map((control, controlIndex) => ({ control, controlIndex }))
		.filter(
			({ control }) =>
				control.visible &&
				control.connected &&
				!control.disabled &&
				control.tagName === "BUTTON",
		);
	const matches = controls.filter(({ control }) => {
		const text = normalize(control.text);
		const ariaLabel = normalize(control.ariaLabel ?? "");
		switch (input.action) {
			case "ADD_NOTE":
				return text === "add a note" && ariaLabel === "add a note";
			case "SEND_WITHOUT_NOTE":
				return (
					text === "send without a note" && ariaLabel === "send without a note"
				);
			case "DISMISS":
				return control.closeControl && ariaLabel === "dismiss";
		}
		return false;
	});
	if (matches.length === 0) return { status: "NONE" };
	if (matches.length !== 1) return { status: "AMBIGUOUS" };
	const match = matches[0];
	if (!match) return { status: "NONE" };
	return {
		status: "FOUND",
		modalIndex: modal.elementIndex,
		controlIndex: match.controlIndex,
		control: match.control,
	};
}
