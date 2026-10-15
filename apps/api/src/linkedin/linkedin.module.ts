import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { LinkedInActionQueueService } from "./linkedin-action-queue.service";
import { LinkedInChannelService } from "./linkedin-channel.service";
import { LinkedInManualRouter } from "./linkedin-manual.router";
import { LinkedInManualService } from "./linkedin-manual.service";

@Module({
	imports: [TrpcModule],
	providers: [
		LinkedInActionQueueService,
		LinkedInChannelService,
		LinkedInManualRouter,
		LinkedInManualService,
	],
	exports: [
		LinkedInActionQueueService,
		LinkedInChannelService,
		LinkedInManualService,
	],
})
export class LinkedInModule {}
