import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { DuplicateRouter } from "../crm/duplicate.router";
import { ProvidersModule } from "../providers/providers.module";
import { TrpcModule } from "../trpc/trpc.module";
import { AllocationRouter } from "./allocation.router";
import { AllocationService } from "./allocation.service";
import { OperationsRouter } from "./operations.router";
import { OperationsService } from "./operations.service";
import { OutreachLifecycleRouter } from "./outreach.router";

@Module({
	imports: [TrpcModule, ProvidersModule, AgentModule],
	providers: [
		AllocationRouter,
		AllocationService,
		DuplicateRouter,
		OperationsRouter,
		OperationsService,
		OutreachLifecycleRouter,
	],
	exports: [AllocationService, OperationsService],
})
export class OperationsModule {}
