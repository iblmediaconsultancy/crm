import { auth } from "@crm/auth";
import { Controller, Get, Query, Res } from "@nestjs/common";
import {
	AllowAnonymous,
	Session,
	type UserSession,
} from "@thallesp/nestjs-better-auth";
import type { Response } from "express";
import { GoogleCalendarService } from "./google-calendar.service";

type CrmSession = UserSession<typeof auth>;

@Controller("api/integrations/google-calendar")
export class GoogleCalendarController {
	constructor(private readonly google: GoogleCalendarService) {}

	@Get("connect")
	async connect(
		@Session() session: CrmSession,
		@Query("returnTo") returnTo: string | undefined,
		@Res() response: Response,
	) {
		const result = await this.google.authorizationUrl(
			session.user.id,
			returnTo,
		);
		return response.redirect(result.url);
	}

	@Get("callback")
	@AllowAnonymous()
	async callback(
		@Query("code") code: string | undefined,
		@Query("state") state: string | undefined,
		@Query("error") error: string | undefined,
		@Res() response: Response,
	) {
		if (error || !code || !state) {
			return response.redirect(this.google.callbackRedirect("error"));
		}
		try {
			const returnTo = await this.google.completeAuthorization(code, state);
			return response.redirect(
				this.google.callbackRedirect("connected", returnTo),
			);
		} catch {
			return response.redirect(this.google.callbackRedirect("error"));
		}
	}
}
