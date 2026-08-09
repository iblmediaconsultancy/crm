import { Module } from "@nestjs/common";
import { defaultMiabProviders, MiabSyncService } from "./miab-sync.service";
import {
	defaultResendProviders,
	OutboundDeliveryService,
} from "./outbound-delivery.service";

@Module({
	providers: [
		MiabSyncService,
		OutboundDeliveryService,
		...defaultMiabProviders,
		...defaultResendProviders,
	],
	exports: [MiabSyncService, OutboundDeliveryService],
})
export class ProvidersModule {}
