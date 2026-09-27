import { Module } from "@nestjs/common";
import { LinkedInActionQueueService } from "./linkedin-action-queue.service";
import { LinkedInChannelService } from "./linkedin-channel.service";

@Module({
	providers: [LinkedInActionQueueService, LinkedInChannelService],
	exports: [LinkedInActionQueueService, LinkedInChannelService],
})
export class LinkedInModule {}
