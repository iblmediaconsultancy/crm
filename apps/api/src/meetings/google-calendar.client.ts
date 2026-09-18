import { Injectable, Logger } from "@nestjs/common";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const TOKEN_API = "https://oauth2.googleapis.com/token";

export type GoogleCalendarEvent = {
	id?: string;
	iCalUID?: string;
	status?: string;
	summary?: string;
	description?: string;
	location?: string;
	hangoutLink?: string;
	start?: { dateTime?: string; date?: string };
	end?: { dateTime?: string; date?: string };
	attendees?: Array<{
		email?: string;
		displayName?: string;
		responseStatus?: string;
	}>;
};

export type GoogleBusyInterval = {
	start: string;
	end: string;
};

export type GoogleFreeBusyResponse = {
	calendars?: Record<
		string,
		{ busy?: GoogleBusyInterval[]; errors?: Array<{ reason?: string }> }
	>;
};

export type GoogleCalendarEventInput = {
	summary: string;
	description?: string;
	start: { dateTime: string; timeZone: string };
	end: { dateTime: string; timeZone: string };
	attendees: Array<{ email: string }>;
};

export type GoogleTokenResponse = {
	accessToken: string;
	refreshToken: string | null;
	expiresIn: number;
	scope: string | null;
};

@Injectable()
export class GoogleCalendarClient {
	private readonly logger = new Logger(GoogleCalendarClient.name);
	private readonly fetcher: typeof fetch = fetch;

	async listEvents(
		accessToken: string,
		calendarId: string,
		from: Date,
		to: Date,
	): Promise<GoogleCalendarEvent[]> {
		const events: GoogleCalendarEvent[] = [];
		let pageToken: string | undefined;
		for (let page = 0; page < 10; page += 1) {
			const data = await this.request<{
				items?: GoogleCalendarEvent[];
				nextPageToken?: string;
			}>(
				accessToken,
				`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
				{
					method: "GET",
					params: {
						showDeleted: "true",
						singleEvents: "true",
						orderBy: "startTime",
						maxResults: "2500",
						timeMin: from.toISOString(),
						timeMax: to.toISOString(),
						pageToken,
					},
				},
			);
			events.push(...(data.items ?? []));
			pageToken = data.nextPageToken;
			if (!pageToken) return events;
		}
		return events;
	}

	async freeBusy(
		accessToken: string,
		calendarIds: string[],
		from: Date,
		to: Date,
	): Promise<GoogleFreeBusyResponse> {
		return this.request<GoogleFreeBusyResponse>(
			accessToken,
			`${CALENDAR_API}/freeBusy`,
			{
				method: "POST",
				body: {
					timeMin: from.toISOString(),
					timeMax: to.toISOString(),
					items: calendarIds.map((id) => ({ id })),
				},
			},
		);
	}

	async createEvent(
		accessToken: string,
		calendarId: string,
		input: GoogleCalendarEventInput,
	): Promise<GoogleCalendarEvent> {
		return this.request<GoogleCalendarEvent>(
			accessToken,
			`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
			{ method: "POST", body: input },
		);
	}

	async refreshAccessToken(
		refreshToken: string,
		clientId: string,
		clientSecret: string,
	): Promise<{ accessToken: string; expiresIn: number }> {
		const response = await this.fetcher(TOKEN_API, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				refresh_token: refreshToken,
				grant_type: "refresh_token",
			}),
		});
		if (!response.ok)
			throw new Error(`GOOGLE_TOKEN_REFRESH_${response.status}`);
		const data = (await response.json()) as {
			access_token?: string;
			expires_in?: number;
		};
		if (!data.access_token)
			throw new Error("GOOGLE_TOKEN_REFRESH_MISSING_ACCESS_TOKEN");
		return {
			accessToken: data.access_token,
			expiresIn: data.expires_in ?? 3600,
		};
	}

	async exchangeCode(
		code: string,
		clientId: string,
		clientSecret: string,
		redirectUri: string,
	): Promise<GoogleTokenResponse> {
		const response = await this.fetcher(TOKEN_API, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code,
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: redirectUri,
				grant_type: "authorization_code",
			}),
		});
		if (!response.ok)
			throw new Error(`GOOGLE_TOKEN_EXCHANGE_${response.status}`);
		const data = (await response.json()) as {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
			scope?: string;
		};
		if (!data.access_token)
			throw new Error("GOOGLE_TOKEN_EXCHANGE_MISSING_ACCESS_TOKEN");
		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token ?? null,
			expiresIn: data.expires_in ?? 3600,
			scope: data.scope ?? null,
		};
	}

	async revokeToken(token: string): Promise<void> {
		const response = await this.fetcher(
			`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
			{ method: "POST" },
		);
		if (!response.ok) throw new Error(`GOOGLE_TOKEN_REVOKE_${response.status}`);
	}

	private async request<T>(
		accessToken: string,
		url: string,
		input: {
			method: "GET" | "POST";
			params?: Record<string, string | undefined>;
			body?: unknown;
		},
	): Promise<T> {
		const target = new URL(url);
		for (const [key, value] of Object.entries(input.params ?? {})) {
			if (value !== undefined) target.searchParams.set(key, value);
		}
		const response = await this.fetcher(target, {
			method: input.method,
			headers: {
				authorization: `Bearer ${accessToken}`,
				...(input.body ? { "content-type": "application/json" } : {}),
			},
			body: input.body ? JSON.stringify(input.body) : undefined,
		});
		if (!response.ok) {
			this.logger.warn({
				message: "Google Calendar request failed",
				status: response.status,
			});
			throw new Error(`GOOGLE_CALENDAR_HTTP_${response.status}`);
		}
		return (await response.json()) as T;
	}
}
