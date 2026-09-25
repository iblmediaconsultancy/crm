export type LinkedInRelationshipControlAction =
	| "CONNECT"
	| "PENDING"
	| "MESSAGE";

export type LinkedInRelationshipControl = {
	elementIndex: number;
	tagName: string;
	role: string | null;
	text: string;
	ariaLabel: string | null;
	href: string | null;
	targetProfile: boolean;
	visible: boolean;
	connected: boolean;
};

export type LinkedInRelationshipControlResolution =
	| { status: "NONE" }
	| { status: "FOUND"; control: LinkedInRelationshipControl }
	| { status: "AMBIGUOUS" };

type ResolveInput = {
	action: LinkedInRelationshipControlAction;
	profileIdentifier: string | null;
	displayName: string | null;
	controls: LinkedInRelationshipControl[];
};

export function resolveLinkedInRelationshipControl(
	input: ResolveInput,
): LinkedInRelationshipControlResolution {
	function normalizeControlText(value: string): string {
		return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
	}

	function profileIdentifierMatches(
		value: string,
		profileIdentifier: string,
	): boolean {
		try {
			return (
				decodeURIComponent(value).toLocaleLowerCase() ===
				decodeURIComponent(profileIdentifier).toLocaleLowerCase()
			);
		} catch {
			return (
				value.toLocaleLowerCase() === profileIdentifier.toLocaleLowerCase()
			);
		}
	}

	function invitationHrefTargetsProfile(
		href: string,
		profileIdentifier: string | null,
	): boolean {
		if (!profileIdentifier) return false;
		try {
			const url = new URL(href, "https://www.linkedin.com");
			if (!/\/preload\/custom-invite\//i.test(url.pathname)) return false;
			const vanityName = url.searchParams.get("vanityName");
			return vanityName
				? profileIdentifierMatches(vanityName, profileIdentifier)
				: false;
		} catch {
			return false;
		}
	}

	function labelIncludesDisplayName(
		label: string | null,
		displayName: string | null,
	): boolean {
		if (!label || !displayName) return false;
		return normalizeControlText(label).includes(
			normalizeControlText(displayName),
		);
	}

	function ariaLabelTargetsAnotherProfile(
		ariaLabel: string | null,
		displayName: string | null,
	): boolean {
		if (!ariaLabel || !displayName) return false;
		const label = normalizeControlText(ariaLabel);
		if (labelIncludesDisplayName(ariaLabel, displayName)) return false;
		return /\b(?:to|naar|for|voor)\b/.test(label);
	}

	function isConnectLabel(value: string): boolean {
		return (
			value.includes("connect") ||
			value.includes("connectie maken") ||
			value.includes("verbinden")
		);
	}

	function isPendingLabel(value: string): boolean {
		return (
			value.includes("pending") ||
			value.includes("withdraw") ||
			value.includes("intrekken") ||
			value.includes("in behandeling") ||
			value.includes("invitation sent") ||
			value.includes("uitnodiging verzonden")
		);
	}

	function isMessageLabel(value: string): boolean {
		return value.includes("message") || value.includes("bericht");
	}

	function isMessageHref(value: string | null): boolean {
		return Boolean(value && /\/messaging\/compose\//i.test(value));
	}

	function ariaLabelTargetsAnotherMessageProfile(
		ariaLabel: string | null,
		displayName: string | null,
	): boolean {
		if (!ariaLabel || !displayName) return false;
		const normalized = normalizeControlText(ariaLabel);
		if (!isMessageLabel(normalized)) return false;
		if (labelIncludesDisplayName(ariaLabel, displayName)) return false;
		return normalized.replace(/\b(?:message|bericht)\b/g, "").trim().length > 0;
	}

	function isConnectControl(control: LinkedInRelationshipControl): boolean {
		const label = normalizeControlText(
			`${control.text} ${control.ariaLabel ?? ""}`,
		);
		if (!isConnectLabel(label)) return false;
		if (ariaLabelTargetsAnotherProfile(control.ariaLabel, input.displayName))
			return false;
		if (control.href) {
			if (/\/preload\/custom-invite\//i.test(control.href))
				return invitationHrefTargetsProfile(
					control.href,
					input.profileIdentifier,
				);
			return labelIncludesDisplayName(control.ariaLabel, input.displayName);
		}
		return (
			control.tagName === "BUTTON" ||
			control.role?.toLocaleLowerCase() === "button" ||
			labelIncludesDisplayName(control.ariaLabel, input.displayName)
		);
	}

	function isPendingControl(control: LinkedInRelationshipControl): boolean {
		return isPendingLabel(
			normalizeControlText(`${control.text} ${control.ariaLabel ?? ""}`),
		);
	}

	function isMessageControl(control: LinkedInRelationshipControl): boolean {
		const label = normalizeControlText(
			`${control.text} ${control.ariaLabel ?? ""}`,
		);
		if (
			ariaLabelTargetsAnotherMessageProfile(
				control.ariaLabel,
				input.displayName,
			)
		)
			return false;
		if (control.href && !isMessageHref(control.href)) return false;
		if (isMessageLabel(label)) return true;
		return isMessageHref(control.href) && control.targetProfile;
	}

	const targetControls = input.controls.filter(
		(control) => control.targetProfile && control.visible && control.connected,
	);
	const candidates = targetControls.filter((control) => {
		switch (input.action) {
			case "CONNECT":
				return isConnectControl(control);
			case "PENDING":
				return isPendingControl(control);
			case "MESSAGE":
				return isMessageControl(control);
		}
		return false;
	});
	if (candidates.length === 0) return { status: "NONE" };
	if (candidates.length !== 1) return { status: "AMBIGUOUS" };
	const [control] = candidates;
	return control ? { status: "FOUND", control } : { status: "NONE" };
}
