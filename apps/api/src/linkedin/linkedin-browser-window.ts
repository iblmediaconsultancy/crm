export type LinkedInBrowserWindowObservation = {
	windowState: string;
	windowWidth: number;
	viewportWidth: number;
	pageVisible: boolean;
	pageFocused?: boolean;
};

export type LinkedInBrowserPageCandidate = {
	id: string;
	observation: LinkedInBrowserWindowObservation;
};

export type LinkedInBrowserPageSelection =
	| { status: "SELECTED"; id: string }
	| { status: "NONE" }
	| { status: "AMBIGUOUS" };

export function selectLinkedInBrowserPage(
	candidates: LinkedInBrowserPageCandidate[],
): LinkedInBrowserPageSelection {
	const selectable = candidates.filter((candidate) =>
		linkedInBrowserPageSelectable(candidate.observation),
	);
	if (selectable.length === 1 && selectable[0])
		return { status: "SELECTED", id: selectable[0].id };
	if (selectable.length > 1) return { status: "AMBIGUOUS" };
	if (candidates.length === 1 && candidates[0])
		return { status: "SELECTED", id: candidates[0].id };
	return candidates.length ? { status: "AMBIGUOUS" } : { status: "NONE" };
}

export type LinkedInBrowserWindowOptions = {
	timeoutMs?: number;
	intervalMs?: number;
	now?: () => number;
	wait?: (milliseconds: number) => Promise<void>;
};

export function linkedInBrowserWindowReady(
	observation: LinkedInBrowserWindowObservation,
): boolean {
	return (
		linkedInBrowserPageSelectable(observation) &&
		observation.pageFocused !== false
	);
}

function linkedInBrowserPageSelectable(
	observation: LinkedInBrowserWindowObservation,
): boolean {
	return (
		observation.windowState !== "minimized" &&
		observation.windowWidth >= 1024 &&
		observation.viewportWidth >= 1024 &&
		observation.pageVisible
	);
}

export async function waitForLinkedInBrowserWindow(
	inspect: () => Promise<LinkedInBrowserWindowObservation>,
	activate: () => Promise<void>,
	options: LinkedInBrowserWindowOptions = {},
): Promise<LinkedInBrowserWindowObservation> {
	const now = options.now ?? Date.now;
	const wait =
		options.wait ??
		((milliseconds) =>
			new Promise((resolve) => setTimeout(resolve, milliseconds)));
	let observation = await inspect();
	if (linkedInBrowserWindowReady(observation)) return observation;
	await activate();
	const startedAt = now();
	while (now() - startedAt < (options.timeoutMs ?? 5000)) {
		await wait(options.intervalMs ?? 100);
		observation = await inspect();
		if (linkedInBrowserWindowReady(observation)) return observation;
	}
	throw new Error("LINKEDIN_BROWSER_NOT_INTERACTIVE");
}

export type LinkedInCdpNavigationReply = {
	errorText?: string;
};

export function linkedInNavigationError(
	reply: LinkedInCdpNavigationReply,
): string | null {
	return reply.errorText ? "LINKEDIN_NAVIGATION_FAILED" : null;
}
