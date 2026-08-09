import type { ProviderCapability } from "@crm/db";
import { Inject } from "@nestjs/common";
import { Query, Router, UseMiddlewares } from "nestjs-trpc";
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
}
