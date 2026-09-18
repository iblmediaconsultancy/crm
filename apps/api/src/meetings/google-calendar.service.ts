import { readFile } from "node:fs/promises";
import type { Db } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import {
	BadRequestException,
	Injectable,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import { InjectDatabase } from "../database/database.constants";
import {
	GoogleCalendarClient,
	type GoogleCalendarEvent,
} from "./google-calendar.client";

const GOOGLE_PROVIDER_ID = "google";
const READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

@Injectable()
export class GoogleCalendarService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly client: GoogleCalendarClient,
		private readonly config: ConfigService<EnvironmentVariables, true>,
	) {}

	async status(userId: string) {
		return withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			const account = await tx.account.findFirst({
				where: { userId, providerId: GOOGLE_PROVIDER_ID },
				select: { scope: true, refreshToken: true, accessToken: true },
			});
			const scopes = parseScopes(account?.scope);
			return {
				configured: Boolean(this.clientId() && (await this.clientSecret())),
				linked: Boolean(account),
				readAccess: scopes.has(READ_SCOPE) || scopes.has(WRITE_SCOPE),
				writeAccess: scopes.has(WRITE_SCOPE),
				hasRefreshToken: Boolean(account?.refreshToken),
				primaryCalendarId: this.primaryCalendarId(),
				hvaCalendarId:
					this.config.get("GOOGLE_CALENDAR_HVA_ID", { infer: true })?.trim() ||
					null,
				blockedCalendarIds: this.blockedCalendarIds(),
			};
		});
	}

	async availability(userId: string, startsAt: Date, endsAt: Date) {
		if (endsAt <= startsAt)
			throw new BadRequestException("Meeting end must be after its start.");
		const accessToken = await this.accessToken(userId, READ_SCOPE);
		const calendars = [this.primaryCalendarId(), ...this.blockedCalendarIds()];
		const response = await this.client.freeBusy(
			accessToken,
			calendars,
			startsAt,
			endsAt,
		);
		const busy = Object.entries(response.calendars ?? {}).flatMap(
			([calendarId, value]) =>
				(value?.busy ?? []).map((interval) => ({ calendarId, ...interval })),
		);
		return {
			status: busy.length === 0 ? ("AVAILABLE" as const) : ("BUSY" as const),
			primaryCalendarId: this.primaryCalendarId(),
			blockedCalendarIds: this.blockedCalendarIds(),
			busy,
		};
	}

	async syncEvents(
		userId: string,
		from: Date,
		to: Date,
	): Promise<{ written: number }> {
		const accessToken = await this.accessToken(userId, READ_SCOPE);
		const events = await this.client.listEvents(
			accessToken,
			this.primaryCalendarId(),
			from,
			to,
		);
		let written = 0;
		await withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			for (const event of events) {
				const start = eventDate(event.start);
				const end = eventDate(event.end);
				if (!start || !end) continue;
				const iCalUid =
					event.iCalUID ?? `google:${event.id ?? crypto.randomUUID()}`;
				await tx.calendarEvent.upsert({
					where: {
						iCalUid_originalStartTime: { iCalUid, originalStartTime: start },
					},
					create: {
						iCalUid,
						originalStartTime: start,
						title: event.summary ?? null,
						description: event.description ?? null,
						location: event.location ?? null,
						conferenceUrl: event.hangoutLink ?? null,
						startsAt: start,
						endsAt: end,
						isAllDay: Boolean(event.start?.date),
						status: event.status ?? "confirmed",
						organizerEmail: null,
						syncedByUserId: userId,
						googleEventId: event.id ?? null,
					},
					update: {
						title: event.summary ?? null,
						description: event.description ?? null,
						location: event.location ?? null,
						conferenceUrl: event.hangoutLink ?? null,
						startsAt: start,
						endsAt: end,
						isAllDay: Boolean(event.start?.date),
						status: event.status ?? "confirmed",
						googleEventId: event.id ?? null,
					},
				});
				written += 1;
			}
		});
		return { written };
	}

	async createEvent(
		userId: string,
		input: {
			calendarId: string;
			title: string;
			description?: string;
			startsAt: Date;
			endsAt: Date;
			timeZone: string;
			attendeeEmails: string[];
		},
	) {
		const accessToken = await this.accessToken(userId, WRITE_SCOPE);
		return this.client.createEvent(accessToken, input.calendarId, {
			summary: input.title,
			description: input.description,
			start: {
				dateTime: input.startsAt.toISOString(),
				timeZone: input.timeZone,
			},
			end: { dateTime: input.endsAt.toISOString(), timeZone: input.timeZone },
			attendees: input.attendeeEmails.map((email) => ({ email })),
		});
	}

	private async accessToken(
		userId: string,
		requiredScope: string,
	): Promise<string> {
		return withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			const account = await tx.account.findFirst({
				where: { userId, providerId: GOOGLE_PROVIDER_ID },
				select: {
					id: true,
					scope: true,
					accessToken: true,
					refreshToken: true,
					accessTokenExpiresAt: true,
				},
			});
			const scopes = parseScopes(account?.scope);
			if (
				!account ||
				(!scopes.has(requiredScope) &&
					!(requiredScope === READ_SCOPE && scopes.has(WRITE_SCOPE)))
			)
				throw new ServiceUnavailableException(
					"Google Calendar access is not connected for this user.",
				);
			if (
				account.accessToken &&
				account.accessTokenExpiresAt &&
				account.accessTokenExpiresAt.getTime() > Date.now() + 60_000
			)
				return account.accessToken;
			if (!account.refreshToken)
				throw new ServiceUnavailableException(
					"Google Calendar requires reconnecting the account.",
				);
			const clientId = this.clientId();
			const clientSecret = await this.clientSecret();
			if (!clientId || !clientSecret)
				throw new ServiceUnavailableException(
					"Google Calendar OAuth credentials are not configured.",
				);
			const refreshed = await this.client.refreshAccessToken(
				account.refreshToken,
				clientId,
				clientSecret,
			);
			await tx.account.update({
				where: { id: account.id },
				data: {
					accessToken: refreshed.accessToken,
					accessTokenExpiresAt: new Date(
						Date.now() + refreshed.expiresIn * 1000,
					),
				},
			});
			return refreshed.accessToken;
		});
	}

	private clientId(): string | undefined {
		return (
			this.config.get("GOOGLE_CALENDAR_CLIENT_ID", { infer: true })?.trim() ||
			undefined
		);
	}

	private async clientSecret(): Promise<string | undefined> {
		const file = this.config
			.get("GOOGLE_CALENDAR_CLIENT_SECRET_FILE", { infer: true })
			?.trim();
		if (file) return (await readFile(file, "utf8")).trim() || undefined;
		return (
			this.config
				.get("GOOGLE_CALENDAR_CLIENT_SECRET", { infer: true })
				?.trim() || undefined
		);
	}

	private primaryCalendarId(): string {
		return (
			this.config.get("GOOGLE_CALENDAR_PRIMARY_ID", { infer: true })?.trim() ||
			"primary"
		);
	}

	private blockedCalendarIds(): string[] {
		const ids = [
			this.config.get("GOOGLE_CALENDAR_HVA_ID", { infer: true })?.trim(),
			...(
				this.config.get("GOOGLE_CALENDAR_BLOCKER_IDS", { infer: true }) ?? ""
			).split(","),
		];
		return [
			...new Set(
				ids
					.filter((value): value is string => Boolean(value))
					.map((value) => value.trim())
					.filter(Boolean),
			),
		];
	}
}

function parseScopes(scope: string | null | undefined): Set<string> {
	return new Set(
		(scope ?? "")
			.split(/[\s,]+/)
			.map((value) => value.trim())
			.filter(Boolean),
	);
}

function eventDate(
	value: GoogleCalendarEvent["start"] | GoogleCalendarEvent["end"] | undefined,
): Date | null {
	const raw =
		value?.dateTime ?? (value?.date ? `${value.date}T00:00:00Z` : null);
	if (!raw) return null;
	const date = new Date(raw);
	return Number.isNaN(date.getTime()) ? null : date;
}
