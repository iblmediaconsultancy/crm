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
import {
	allocationEnqueueInput,
	allocationOverrideInput,
	allocationPolicyActivateInput,
	allocationPolicyCreateInput,
	allocationTargetInput,
} from "./allocation.contracts";
import { AllocationService } from "./allocation.service";

@Router({ alias: "allocation" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class AllocationRouter {
	constructor(private readonly allocation: AllocationService) {}
	@Query({ meta: { permission: "allocation.manage" } }) listPolicies() {
		return this.allocation.listPolicies();
	}
	@Query({ meta: { permission: "allocation.manage" } }) overview() {
		return this.allocation.overview();
	}
	@Query({
		input: allocationTargetInput,
		meta: { permission: "allocation.manage" },
	})
	preview(@Input() input: z.infer<typeof allocationTargetInput>) {
		return this.allocation.preview(input.entityType, input.entityId);
	}
	@Mutation({
		input: allocationPolicyCreateInput,
		meta: { permission: "workspace.manage" },
	})
	createPolicy(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof allocationPolicyCreateInput>,
	) {
		return this.allocation.createPolicy(ctx.user.id, input);
	}
	@Mutation({
		input: allocationPolicyActivateInput,
		meta: { permission: "workspace.manage" },
	})
	activatePolicy(@Input("policyId") policyId: string) {
		return this.allocation.activate(policyId);
	}
	@Mutation({
		input: allocationEnqueueInput,
		meta: { permission: "allocation.manage" },
	})
	enqueue(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof allocationEnqueueInput>,
	) {
		return this.allocation.enqueue(ctx.user.id, input);
	}
	@Mutation({
		input: allocationOverrideInput,
		meta: { permission: "allocation.manage" },
	})
	override(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof allocationOverrideInput>,
	) {
		return this.allocation.override(ctx.user.id, input);
	}
}
