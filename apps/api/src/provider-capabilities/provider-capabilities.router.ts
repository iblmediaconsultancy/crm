import type { ProviderCapability } from "@crm/db";
import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { PermissionMiddleware } from "../trpc/middlewares/permission.middleware";
import { verifyMailboxInput } from "./provider-capabilities.contracts";
import { ProviderCapabilitiesService } from "./provider-capabilities.service";

@Router({ alias: "providerCapabilities" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class ProviderCapabilitiesRouter {
	constructor(
		@Inject(ProviderCapabilitiesService)
		private readonly capabilities: ProviderCapabilitiesService,
	) {}

	@Query({ meta: { permission: "crm.read" } })
	get(): Promise<ProviderCapability[]> {
		return this.capabilities.get();
	}

	@Query({ meta: { permission: "crm.read" } })
	operations(@Ctx() ctx: AuthedTrpcContext) {
		return this.capabilities.operations(ctx.user.id);
	}

	@Query({ meta: { permission: "crm.read" } })
	mailboxVerification(@Ctx() ctx: AuthedTrpcContext) {
		return this.capabilities.mailboxVerification(ctx.user.id);
	}

	@Mutation({
		input: verifyMailboxInput,
		meta: { permission: "providers.verify" },
	})
	verifyMailbox(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() _input: z.infer<typeof verifyMailboxInput>,
	) {
		return this.capabilities.verifyMailbox(ctx.user.id);
	}
}
