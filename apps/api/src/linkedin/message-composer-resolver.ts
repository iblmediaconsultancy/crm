export type LinkedInMessageComposerElement = {
	index: number;
	nodeIdentity?: number;
	tagName: string;
	role: string | null;
	ariaLabel: string | null;
	name: string | null;
	placeholder: string | null;
	text: string;
	contentEditable: boolean;
	visible: boolean;
	connected: boolean;
	disabled: boolean;
};

export type LinkedInMessageComposerSurface = {
	index: number;
	kind: "THREAD" | "COMPOSE_OVERLAY" | "PROFILE_COMPOSE" | "DIALOG";
	recipientIdentifier: string | null;
	externalConversationKey: string | null;
	externalMessageKey: string | null;
	recipientCount: number;
	visible: boolean;
	connected: boolean;
	editors: LinkedInMessageComposerElement[];
	sendControls: LinkedInMessageComposerElement[];
};

export type LinkedInMessageComposerSnapshot = {
	url: string;
	surfaces: LinkedInMessageComposerSurface[];
};

export type LinkedInMessageComposerResolution =
	| { status: "NONE" }
	| { status: "LOADING" }
	| { status: "AMBIGUOUS" }
	| {
			status: "FOUND";
			surfaceIndex: number;
			editorIndex: number;
			sendControlIndex: number;
			recipientIdentifier: string | null;
			externalConversationKey: string | null;
			externalMessageKey: string | null;
			editorIdentity?: number;
	  };

export function linkedInMessageComposerControlReady(
	control: Pick<
		LinkedInMessageComposerElement,
		"visible" | "connected" | "disabled"
	>,
): boolean {
	return control.visible && control.connected && !control.disabled;
}

export function linkedInMessageControlRecipientIdentifier(
	href: string | null,
): string | null {
	if (!href) return null;
	try {
		const url = new URL(href, "https://www.linkedin.com");
		if (!/^\/messaging\/compose\/?$/i.test(url.pathname)) return null;
		const recipient = url.searchParams.get("recipient")?.trim() ?? "";
		const profileUrn = url.searchParams.get("profileUrn")?.trim() ?? "";
		const profileMember = profileUrn.split(":").at(-1)?.trim() ?? "";
		if (!/^ACo[A-Za-z0-9_-]+$/.test(recipient)) return null;
		return profileMember === recipient ? recipient : null;
	} catch {
		return null;
	}
}

export function linkedInMessageControlConversationKey(
	href: string | null,
): string | null {
	if (!href) return null;
	try {
		const url = new URL(href, "https://www.linkedin.com");
		const match = url.pathname.match(/^\/messaging\/thread\/([^/?#]+)\/?$/i);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
}

export function resolveLinkedInMessageComposer(
	snapshot: LinkedInMessageComposerSnapshot,
	input: {
		expectedRecipientIdentifier?: string | null;
		expectedExternalConversationKey?: string | null;
	},
): LinkedInMessageComposerResolution {
	const normalizeKey = (value: string | null | undefined): string | null => {
		if (!value) return null;
		const trimmed = value.trim();
		if (!trimmed) return null;
		try {
			const url = new URL(
				trimmed.startsWith("/") ? `https://linkedin.com${trimmed}` : trimmed,
			);
			const match = url.pathname.match(/^\/messaging\/thread\/([^/?#]+)\/?$/i);
			if (match?.[1]) return decodeURIComponent(match[1]);
		} catch {}
		return trimmed;
	};
	const expectedRecipient = input.expectedRecipientIdentifier?.trim() || null;
	const expectedConversation = normalizeKey(
		input.expectedExternalConversationKey,
	);
	const candidates = snapshot.surfaces.filter((surface) => {
		if (!surface.visible || !surface.connected) return false;
		if (!surface.recipientIdentifier && !expectedConversation) return false;
		if (expectedRecipient && surface.recipientIdentifier !== expectedRecipient)
			return false;
		const surfaceConversation = normalizeKey(surface.externalConversationKey);
		if (
			expectedConversation &&
			surfaceConversation &&
			surfaceConversation !== expectedConversation
		)
			return false;
		if (expectedConversation && !surfaceConversation && !expectedRecipient)
			return false;
		return true;
	});
	if (candidates.length === 0) return { status: "NONE" };
	if (candidates.length !== 1) return { status: "AMBIGUOUS" };
	const surface = candidates[0];
	if (surface?.recipientCount === 0) return { status: "LOADING" };
	if (surface?.recipientCount !== 1) return { status: "AMBIGUOUS" };
	const editors = surface.editors.filter(
		(editor) =>
			editor.visible &&
			editor.connected &&
			!editor.disabled &&
			(editor.contentEditable ||
				editor.role?.toLocaleLowerCase() === "textbox" ||
				editor.tagName.toLocaleLowerCase() === "textarea"),
	);
	const sendControls = surface.sendControls.filter(
		(control) => control.visible && control.connected,
	);
	if (editors.length > 1 || sendControls.length > 1)
		return { status: "AMBIGUOUS" };
	if (editors.length === 0 || sendControls.length === 0)
		return { status: "LOADING" };
	return {
		status: "FOUND",
		surfaceIndex: surface.index,
		editorIndex: editors[0]?.index ?? -1,
		sendControlIndex: sendControls[0]?.index ?? -1,
		recipientIdentifier: surface.recipientIdentifier,
		externalConversationKey: surface.externalConversationKey,
		externalMessageKey: surface.externalMessageKey,
		...(editors[0]?.nodeIdentity === undefined
			? {}
			: { editorIdentity: editors[0].nodeIdentity }),
	};
}

export async function waitForStableLinkedInMessageComposer(
	inspect: () => Promise<LinkedInMessageComposerResolution>,
	options: {
		timeoutMs?: number;
		intervalMs?: number;
		now?: () => number;
		wait?: (milliseconds: number) => Promise<void>;
	} = {},
): Promise<
	LinkedInMessageComposerResolution & {
		observations: number;
		elapsedMs: number;
	}
> {
	const now = options.now ?? Date.now;
	const wait =
		options.wait ??
		((milliseconds) =>
			new Promise((resolve) => setTimeout(resolve, milliseconds)));
	const startedAt = now();
	let observations = 0;
	let stable: Extract<
		LinkedInMessageComposerResolution,
		{ status: "FOUND" }
	> | null = null;
	let last: LinkedInMessageComposerResolution = { status: "NONE" };
	while (now() - startedAt < (options.timeoutMs ?? 15000)) {
		last = await inspect();
		observations += 1;
		if (last.status === "AMBIGUOUS")
			return { ...last, observations, elapsedMs: now() - startedAt };
		if (last.status === "FOUND") {
			if (stable && JSON.stringify(stable) === JSON.stringify(last))
				return { ...last, observations, elapsedMs: now() - startedAt };
			stable = last;
		} else stable = null;
		await wait(options.intervalMs ?? 250);
	}
	return {
		status: last.status === "FOUND" ? "LOADING" : last.status,
		observations,
		elapsedMs: now() - startedAt,
	};
}
