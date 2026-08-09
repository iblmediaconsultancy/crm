import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { ProviderCapabilitiesRouter } from "./provider-capabilities.router";
import { ProviderCapabilitiesService } from "./provider-capabilities.service";

@Module({
	imports: [TrpcModule],
	providers: [ProviderCapabilitiesRouter, ProviderCapabilitiesService],
	exports: [ProviderCapabilitiesService],
})
export class ProviderCapabilitiesModule {}
