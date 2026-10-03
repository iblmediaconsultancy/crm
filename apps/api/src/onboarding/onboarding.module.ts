import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { OnboardingRouter } from "./onboarding.router";
import { OnboardingService } from "./onboarding.service";

@Module({
	imports: [TrpcModule],
	providers: [OnboardingRouter, OnboardingService],
})
export class OnboardingModule {}
