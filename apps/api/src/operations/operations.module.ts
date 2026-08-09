import { Module } from "@nestjs/common";
import { ProvidersModule } from "../providers/providers.module";
import { TrpcModule } from "../trpc/trpc.module";
import { OperationsRouter } from "./operations.router";
import { OperationsService } from "./operations.service";

@Module({
	imports: [TrpcModule, ProvidersModule],
	providers: [OperationsRouter, OperationsService],
	exports: [OperationsService],
})
export class OperationsModule {}
