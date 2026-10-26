import { describe, expect, it } from "bun:test";
import {
	linkedInBrowserWindowReady,
	linkedInNavigationError,
	waitForLinkedInBrowserWindow,
} from "../src/linkedin/linkedin-browser-window";

const ready = {
	windowState: "maximized",
	windowWidth: 1400,
	viewportWidth: 1376,
	pageVisible: true,
	pageFocused: true,
};

describe("LinkedIn browser window readiness", () => {
	it("requires an active desktop-sized visible page", () => {
		expect(linkedInBrowserWindowReady(ready)).toBe(true);
		expect(
			linkedInBrowserWindowReady({
				...ready,
				windowState: "minimized",
			}),
		).toBe(false);
		expect(linkedInBrowserWindowReady({ ...ready, windowWidth: 627 })).toBe(
			false,
		);
		expect(linkedInBrowserWindowReady({ ...ready, viewportWidth: 604 })).toBe(
			false,
		);
		expect(linkedInBrowserWindowReady({ ...ready, pageVisible: false })).toBe(
			false,
		);
		expect(linkedInBrowserWindowReady({ ...ready, pageFocused: false })).toBe(
			false,
		);
	});

	it("does not reactivate an already ready browser", async () => {
		let activations = 0;
		const result = await waitForLinkedInBrowserWindow(
			async () => ready,
			async () => {
				activations += 1;
			},
		);
		expect(result).toEqual(ready);
		expect(activations).toBe(0);
	});

	it("activates and waits for a minimized responsive layout to become ready", async () => {
		let activations = 0;
		let time = 0;
		const result = await waitForLinkedInBrowserWindow(
			async () =>
				time < 200
					? { ...ready, windowState: "minimized", pageVisible: false }
					: ready,
			async () => {
				activations += 1;
			},
			{
				now: () => time,
				intervalMs: 100,
				wait: async (milliseconds) => {
					time += milliseconds;
				},
			},
		);
		expect(result).toEqual(ready);
		expect(activations).toBe(1);
		expect(time).toBe(200);
	});

	it("fails closed if the browser never becomes visible at desktop width", async () => {
		let time = 0;
		await expect(
			waitForLinkedInBrowserWindow(
				async () => ({
					...ready,
					viewportWidth: 604,
					pageVisible: false,
					pageFocused: false,
				}),
				async () => undefined,
				{
					timeoutMs: 250,
					intervalMs: 100,
					now: () => time,
					wait: async (milliseconds) => {
						time += milliseconds;
					},
				},
			),
		).rejects.toThrow("LINKEDIN_BROWSER_NOT_INTERACTIVE");
	});
});

describe("LinkedIn CDP page selection", () => {
	it("selects the visible LinkedIn tab instead of a hidden background tab", async () => {
		const { selectLinkedInBrowserPage } = await import(
			"../src/linkedin/linkedin-browser-window"
		);
		expect(
			selectLinkedInBrowserPage([
				{
					id: "background",
					observation: { ...ready, pageVisible: false },
				},
				{ id: "active", observation: ready },
			]),
		).toEqual({ status: "SELECTED", id: "active" });
	});

	it("selects the unique visible page for activation when it is not yet focused", async () => {
		const { selectLinkedInBrowserPage } = await import(
			"../src/linkedin/linkedin-browser-window"
		);
		expect(
			selectLinkedInBrowserPage([
				{
					id: "background",
					observation: { ...ready, pageVisible: false, pageFocused: false },
				},
				{ id: "foreground", observation: { ...ready, pageFocused: false } },
			]),
		).toEqual({ status: "SELECTED", id: "foreground" });
	});

	it("fails closed when multiple LinkedIn tabs are interactive", async () => {
		const { selectLinkedInBrowserPage } = await import(
			"../src/linkedin/linkedin-browser-window"
		);
		expect(
			selectLinkedInBrowserPage([
				{ id: "first", observation: ready },
				{ id: "second", observation: ready },
			]),
		).toEqual({ status: "AMBIGUOUS" });
	});

	it("uses the sole hidden LinkedIn tab only for a state-checked activation attempt", async () => {
		const { selectLinkedInBrowserPage } = await import(
			"../src/linkedin/linkedin-browser-window"
		);
		expect(
			selectLinkedInBrowserPage([
				{
					id: "only-tab",
					observation: {
						...ready,
						windowState: "minimized",
						pageVisible: false,
					},
				},
			]),
		).toEqual({ status: "SELECTED", id: "only-tab" });
	});
});

describe("LinkedIn navigation errors", () => {
	it("maps a suspended navigation to a stable fail-closed error", () => {
		expect(
			linkedInNavigationError({ errorText: "net::ERR_NETWORK_IO_SUSPENDED" }),
		).toBe("LINKEDIN_NAVIGATION_FAILED");
		expect(linkedInNavigationError({})).toBeNull();
	});
});
