import type { ProviderCapability } from "@crm/db";
import { Inject } from "@nestjs/common";
import { Ctx, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { ProviderCapabilitiesService } from "./provider-capabilities.service";

@Router({ alias: "providerCapabilities" })
@UseMiddlewares(AuthMiddleware)
export class ProviderCapabilitiesRouter {
	constructor(
		@Inject(ProviderCapabilitiesService)
		private readonly capabilities: ProviderCapabilitiesService,
	) {}

	@Query()
	get(): Promise<ProviderCapability[]> {
		return this.capabilities.get();
	}

	@Query()
	operations(@Ctx() ctx: AuthedTrpcContext) {
		return this.capabilities.operations(ctx.user.id);
	}
}
