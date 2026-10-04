export type LinkedInBrowserWindowObservation = {
	windowState: string;
	windowWidth: number;
	viewportWidth: number;
	pageVisible: boolean;
};

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
