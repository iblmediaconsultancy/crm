import { describe, expect, it, mock } from "bun:test";
import { GoogleCalendarClient } from "../src/meetings/google-calendar.client";
import {
	GoogleCalendarService,
	READ_SCOPE,
	WRITE_SCOPE,
} from "../src/meetings/google-calendar.service";
import {
	decryptGoogleCalendarToken,
	encryptGoogleCalendarToken,
} from "../src/meetings/google-calendar-token";

describe("Google Calendar OAuth foundation", () => {
	it("builds a stateful offline authorization URL for the signed-in user", async () => {
		let stateRecord: { identifier: string; value: string } | undefined;
		const transaction = {
			$executeRaw: async () => 0,
			user: {
				findUnique: async () => ({
					email: "ihsan@example.test",
					kind: "HUMAN",
					profile: { status: "ACTIVE" },
					members: [{ role: "admin" }],
				}),
			},
			verification: {
				deleteMany: async () => ({ count: 0 }),
				create: async ({ data }: { data: typeof stateRecord }) => {
					stateRecord = data;
				},
			},
		};
		const db = {
			$transaction: async <T>(run: (tx: typeof transaction) => Promise<T>) =>
				run(transaction),
		};
		const config = {
			get: (key: string) =>
				({
					GOOGLE_CALENDAR_CLIENT_ID: "client-id",
					GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret",
					BETTER_AUTH_SECRET: "a-secret-that-is-long-enough-for-tests",
					API_URL: "http://localhost:3001",
				})[key] as string | undefined,
		};
		const service = new GoogleCalendarService(
			db as never,
			{} as never,
			config as never,
		);

		const result = await service.authorizationUrl(
			"ihsan-user",
			"/settings/connections",
		);
		const url = new URL(result.url);
		expect(url.searchParams.get("access_type")).toBe("offline");
		expect(url.searchParams.get("prompt")).toBe("consent");
		expect(url.searchParams.get("login_hint")).toBe("ihsan@example.test");
		expect(url.searchParams.get("redirect_uri")).toBe(
			"http://localhost:3001/api/integrations/google-calendar/callback",
		);
		expect(url.searchParams.get("scope")?.split(" ")).toEqual([
			READ_SCOPE,
			WRITE_SCOPE,
		]);
		expect(url.searchParams.get("state")).toHaveLength(43);
		expect(stateRecord?.identifier).toBe(
			`google-calendar-oauth:${url.searchParams.get("state")}`,
		);
	});

	it("encrypts tokens and rejects tampering", () => {
		const encrypted = encryptGoogleCalendarToken(
			"refresh-token-value",
			"a-secret-that-is-long-enough-for-tests",
		);

		expect(encrypted).not.toContain("refresh-token-value");
		expect(
			decryptGoogleCalendarToken(
				encrypted,
				"a-secret-that-is-long-enough-for-tests",
			),
		).toBe("refresh-token-value");
		expect(() =>
			decryptGoogleCalendarToken(
				`${encrypted}tampered`,
				"a-secret-that-is-long-enough-for-tests",
			),
		).toThrow();
	});

	it("exchanges an authorization code with offline token parameters", async () => {
		const originalFetch = globalThis.fetch;
		const fetchMock = mock(async (input: unknown, init?: RequestInit) => {
			expect(String(input)).toBe("https://oauth2.googleapis.com/token");
			expect(init?.method).toBe("POST");
			const body = new URLSearchParams(String(init?.body));
			expect(body.get("code")).toBe("authorization-code");
			expect(body.get("client_id")).toBe("client-id");
			expect(body.get("client_secret")).toBe("client-secret");
			expect(body.get("redirect_uri")).toBe(
				"http://localhost:3001/api/integrations/google-calendar/callback",
			);
			expect(body.get("grant_type")).toBe("authorization_code");
			return new Response(
				JSON.stringify({
					access_token: "access-token",
					refresh_token: "refresh-token",
					expires_in: 3600,
					scope:
						"https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		try {
			const result = await new GoogleCalendarClient().exchangeCode(
				"authorization-code",
				"client-id",
				"client-secret",
				"http://localhost:3001/api/integrations/google-calendar/callback",
			);
			expect(result).toEqual({
				accessToken: "access-token",
				refreshToken: "refresh-token",
				expiresIn: 3600,
				scope:
					"https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
