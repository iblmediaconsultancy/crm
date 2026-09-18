import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Db } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import {
	BadRequestException,
	ConflictException,
	Injectable,
	Logger,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import { InjectDatabase } from "../database/database.constants";
import {
	GoogleCalendarClient,
	type GoogleCalendarEvent,
} from "./google-calendar.client";
import {
	decryptGoogleCalendarToken,
	encryptGoogleCalendarToken,
} from "./google-calendar-token";

export const GOOGLE_PROVIDER_ID = "google-calendar";
export const READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const OAUTH_STATE_PREFIX = "google-calendar-oauth:";
const OAUTH_STATE_TTL_MS = 10 * 60_000;

@Injectable()
export class GoogleCalendarService {
	private readonly logger = new Logger(GoogleCalendarService.name);

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
				configured: Boolean(
					this.clientId() &&
						(await this.clientSecret()) &&
						this.tokenEncryptionSecret(),
				),
				linked: Boolean(account),
				connected: Boolean(
					account?.refreshToken &&
						scopes.has(READ_SCOPE) &&
						scopes.has(WRITE_SCOPE),
				),
				readAccess: scopes.has(READ_SCOPE),
				writeAccess: scopes.has(WRITE_SCOPE),
				hasRefreshToken: Boolean(account?.refreshToken),
				redirectUri: this.redirectUri(),
				primaryCalendarId: this.primaryCalendarId(),
				hvaCalendarId:
					this.config.get("GOOGLE_CALENDAR_HVA_ID", { infer: true })?.trim() ||
					null,
				blockedCalendarIds: this.blockedCalendarIds(),
			};
		});
	}

	async authorizationUrl(userId: string, returnTo: string | undefined) {
		const clientId = this.clientId();
		const clientSecret = await this.clientSecret();
		if (!clientId || !clientSecret || !this.tokenEncryptionSecret()) {
			throw new ServiceUnavailableException(
				"Google Calendar OAuth is not configured.",
			);
		}
		const safeReturnTo = this.safeReturnTo(returnTo);
		const state = randomBytes(32).toString("base64url");
		const loginHint = await withPrincipal(
			this.db,
			{ userId, kind: "user" },
			async (tx) => {
				const user = await tx.user.findUnique({
					where: { id: userId },
					select: { email: true },
				});
				await tx.verification.deleteMany({
					where: {
						identifier: { startsWith: OAUTH_STATE_PREFIX },
						expiresAt: { lt: new Date() },
					},
				});
				await tx.verification.create({
					data: {
						id: randomUUID(),
						identifier: `${OAUTH_STATE_PREFIX}${state}`,
						value: JSON.stringify({ userId, returnTo: safeReturnTo }),
						expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
					},
				});
				return user?.email;
			},
		);
		const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
		url.searchParams.set("client_id", clientId);
		url.searchParams.set("redirect_uri", this.redirectUri());
		url.searchParams.set("response_type", "code");
		url.searchParams.set("scope", [READ_SCOPE, WRITE_SCOPE].join(" "));
		url.searchParams.set("access_type", "offline");
		url.searchParams.set("include_granted_scopes", "true");
		url.searchParams.set("prompt", "consent");
		url.searchParams.set("state", state);
		if (loginHint) url.searchParams.set("login_hint", loginHint);
		return { url: url.toString() };
	}

	async completeAuthorization(code: string, state: string) {
		const record = await this.db.verification.findFirst({
			where: { identifier: stateVerificationId(state) },
		});
		if (!record || record.expiresAt <= new Date()) {
			throw new BadRequestException("Google Calendar connection has expired.");
		}
		await this.db.verification.delete({ where: { id: record.id } });
		let payload: { userId: string; returnTo: string };
		try {
			payload = JSON.parse(record.value) as {
				userId: string;
				returnTo: string;
			};
		} catch {
			throw new BadRequestException(
				"Google Calendar connection state is invalid.",
			);
		}
		if (!payload.userId || !payload.returnTo) {
			throw new BadRequestException(
				"Google Calendar connection state is invalid.",
			);
		}
		const clientId = this.clientId();
		const clientSecret = await this.clientSecret();
		const encryptionSecret = this.tokenEncryptionSecret();
		if (!clientId || !clientSecret || !encryptionSecret) {
			throw new ServiceUnavailableException(
				"Google Calendar OAuth is not configured.",
			);
		}
		const tokens = await this.client.exchangeCode(
			code,
			clientId,
			clientSecret,
			this.redirectUri(),
		);
		const scopes = parseScopes(tokens.scope ?? "");
		if (!scopes.has(READ_SCOPE) && !scopes.has(WRITE_SCOPE)) {
			throw new ConflictException(
				"Google Calendar read access was not granted.",
			);
		}
		if (!scopes.has(WRITE_SCOPE)) {
			throw new ConflictException(
				"Google Calendar write access was not granted.",
			);
		}
		await withPrincipal(
			this.db,
			{ userId: payload.userId, kind: "user" },
			async (tx) => {
				const current = await tx.account.findFirst({
					where: { userId: payload.userId, providerId: GOOGLE_PROVIDER_ID },
					select: { id: true, refreshToken: true },
				});
				const refreshToken = tokens.refreshToken
					? encryptGoogleCalendarToken(tokens.refreshToken, encryptionSecret)
					: current?.refreshToken;
				if (!refreshToken) {
					throw new ConflictException(
						"Google did not return a refresh token. Reconnect and approve offline access.",
					);
				}
				const data = {
					accountId: `google-calendar:${payload.userId}`,
					providerId: GOOGLE_PROVIDER_ID,
					accessToken: encryptGoogleCalendarToken(
						tokens.accessToken,
						encryptionSecret,
					),
					refreshToken,
					accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
					scope: [...scopes].join(" "),
					password: null,
				};
				if (current) {
					await tx.account.update({ where: { id: current.id }, data });
				} else {
					await tx.account.create({
						data: { id: randomUUID(), userId: payload.userId, ...data },
					});
				}
			},
		);
		return payload.returnTo;
	}

	callbackRedirect(
		status: "connected" | "error",
		returnTo = "/settings/connections",
	) {
		const appUrl =
			this.config.get("APP_URL", { infer: true })?.split(",")[0]?.trim() ||
			"http://localhost:3000";
		const target = new URL(
			this.safeReturnTo(returnTo),
			`${appUrl.replace(/\/$/, "")}/`,
		);
		target.searchParams.set("googleCalendar", status);
		return target.toString();
	}

	async disconnect(userId: string) {
		const account = await withPrincipal(
			this.db,
			{ userId, kind: "user" },
			(tx) =>
				tx.account.findFirst({
					where: { userId, providerId: GOOGLE_PROVIDER_ID },
					select: { id: true, accessToken: true, refreshToken: true },
				}),
		);
		if (!account) return { disconnected: true };
		const secret = this.tokenEncryptionSecret();
		let token: string | null = null;
		if (secret) {
			try {
				token = account.refreshToken
					? decryptGoogleCalendarToken(account.refreshToken, secret)
					: account.accessToken
						? decryptGoogleCalendarToken(account.accessToken, secret)
						: null;
			} catch {
				token = null;
			}
		}
		if (token) {
			try {
				await this.client.revokeToken(token);
			} catch (error) {
				this.logger.warn({
					message:
						"Google Calendar token revocation failed; clearing local tokens",
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		await withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			await tx.account.delete({ where: { id: account.id } });
			await tx.securityAuditEvent.create({
				data: {
					actorUserId: userId,
					action: "GOOGLE_CALENDAR_DISCONNECTED",
					resourceType: "Account",
					resourceId: account.id,
					outcome: "SUCCESS",
				},
			});
		});
		return { disconnected: true };
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
			const encryptionSecret = this.tokenEncryptionSecret();
			if (!encryptionSecret)
				throw new ServiceUnavailableException(
					"Google Calendar token encryption is not configured.",
				);
			const accessToken = account.accessToken
				? decryptGoogleCalendarToken(account.accessToken, encryptionSecret)
				: null;
			if (
				accessToken &&
				account.accessTokenExpiresAt &&
				account.accessTokenExpiresAt.getTime() > Date.now() + 60_000
			)
				return accessToken;
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
				decryptGoogleCalendarToken(account.refreshToken, encryptionSecret),
				clientId,
				clientSecret,
			);
			await tx.account.update({
				where: { id: account.id },
				data: {
					accessToken: encryptGoogleCalendarToken(
						refreshed.accessToken,
						encryptionSecret,
					),
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

	private tokenEncryptionSecret(): string | undefined {
		return (
			this.config.get("BETTER_AUTH_SECRET", { infer: true })?.trim() ||
			undefined
		);
	}

	private redirectUri(): string {
		const apiUrl =
			this.config.get("API_URL", { infer: true })?.trim() ||
			"http://localhost:3001";
		return `${apiUrl.replace(/\/$/, "")}/api/integrations/google-calendar/callback`;
	}

	private safeReturnTo(value: string | undefined): string {
		if (!value?.startsWith("/") || value.startsWith("//")) {
			return "/settings/connections";
		}
		return value;
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

function stateVerificationId(state: string): string {
	return `${OAUTH_STATE_PREFIX}${state}`;
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
