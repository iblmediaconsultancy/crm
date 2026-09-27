import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { ProfileRouter } from "./profile.router";
import { ProfileService } from "./profile.service";

@Module({
	imports: [TrpcModule],
	providers: [ProfileRouter, ProfileService],
	exports: [ProfileService],
})
export class ProfileModule {}
