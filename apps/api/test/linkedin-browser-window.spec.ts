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
				async () => ({ ...ready, viewportWidth: 604, pageVisible: false }),
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

describe("LinkedIn navigation errors", () => {
	it("maps a suspended navigation to a stable fail-closed error", () => {
		expect(
			linkedInNavigationError({ errorText: "net::ERR_NETWORK_IO_SUSPENDED" }),
		).toBe("LINKEDIN_NAVIGATION_FAILED");
		expect(linkedInNavigationError({})).toBeNull();
	});
});
