import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { GoogleCalendarClient } from "./google-calendar.client";
import { GoogleCalendarService } from "./google-calendar.service";
import { MeetingsRouter } from "./meetings.router";
import { MeetingsService } from "./meetings.service";

@Module({
	imports: [TrpcModule],
	providers: [
		GoogleCalendarClient,
		GoogleCalendarService,
		MeetingsRouter,
		MeetingsService,
	],
	exports: [GoogleCalendarService, MeetingsService],
})
export class MeetingsModule {}
