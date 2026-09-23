import { Module } from "@nestjs/common";
import { LinkedInChannelService } from "./linkedin-channel.service";

@Module({
	providers: [LinkedInChannelService],
	exports: [LinkedInChannelService],
})
export class LinkedInModule {}
