import { Module } from "@nestjs/common";
import { ProvidersModule } from "../providers/providers.module";
import { DuplicateRouter } from "../crm/duplicate.router";
import { TrpcModule } from "../trpc/trpc.module";
import { AllocationRouter } from "./allocation.router";
import { AllocationService } from "./allocation.service";
import { OperationsRouter } from "./operations.router";
import { OutreachLifecycleRouter } from "./outreach.router";
import { OperationsService } from "./operations.service";

@Module({
	imports: [TrpcModule, ProvidersModule],
	providers: [AllocationRouter, AllocationService, DuplicateRouter, OperationsRouter, OperationsService, OutreachLifecycleRouter],
	exports: [AllocationService, OperationsService],
})
export class OperationsModule {}
