import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { GoogleCalendarService } from "./google-calendar.service";
import {
	meetingAvailabilityInput,
	meetingIdInput,
	meetingRequestInput,
} from "./meetings.contracts";
import { MeetingsService } from "./meetings.service";

@Router({ alias: "meetings" })
@UseMiddlewares(AuthMiddleware)
export class MeetingsRouter {
	constructor(
		@Inject(MeetingsService) private readonly meetings: MeetingsService,
		@Inject(GoogleCalendarService)
		private readonly google: GoogleCalendarService,
	) {}

	@Query()
	status(@Ctx() ctx: AuthedTrpcContext) {
		return this.google.status(ctx.user.id);
	}

	@Query({ input: meetingAvailabilityInput })
	availability(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof meetingAvailabilityInput>,
	) {
		return this.meetings.availability(
			ctx.user.id,
			input.startsAt,
			input.endsAt,
		);
	}

	@Query()
	list(@Ctx() ctx: AuthedTrpcContext) {
		return this.meetings.list(ctx.user.id);
	}

	@Mutation({ input: meetingRequestInput })
	request(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof meetingRequestInput>,
	) {
		return this.meetings.request(ctx.user.id, input);
	}

	@Mutation({ input: meetingIdInput })
	approve(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof meetingIdInput>,
	) {
		return this.meetings.approve(ctx.user.id, input.id);
	}

	@Mutation({ input: meetingIdInput })
	decline(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof meetingIdInput>,
	) {
		return this.meetings.decline(ctx.user.id, input.id);
	}

	@Mutation({ input: meetingIdInput })
	confirm(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof meetingIdInput>,
	) {
		return this.meetings.confirm(ctx.user.id, input.id);
	}

	@Mutation()
	disconnect(@Ctx() ctx: AuthedTrpcContext) {
		return this.google.disconnect(ctx.user.id);
	}
}
