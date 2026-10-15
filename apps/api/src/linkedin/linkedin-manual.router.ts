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
import {
	linkedinManualBatchInput,
	linkedinManualCancelInput,
	linkedinManualCompleteInput,
	linkedinManualPrepareInput,
	linkedinManualRelationshipInput,
} from "./linkedin-manual.contracts";
import { LinkedInManualService } from "./linkedin-manual.service";

@Router({ alias: "linkedinManual" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class LinkedInManualRouter {
	constructor(
		@Inject(LinkedInManualService)
		private readonly manual: LinkedInManualService,
	) {}

	@Query({ input: linkedinManualBatchInput, meta: { permission: "crm.read" } })
	list(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof linkedinManualBatchInput>,
	) {
		return this.manual.list(ctx.user.id, input);
	}

	@Mutation({
		input: linkedinManualRelationshipInput,
		meta: { permission: "outreach.approve" },
	})
	reconcileRelationship(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof linkedinManualRelationshipInput>,
	) {
		return this.manual.reconcileRelationship(ctx.user.id, input);
	}

	@Mutation({
		input: linkedinManualPrepareInput,
		meta: { permission: "outreach.approve" },
	})
	prepare(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof linkedinManualPrepareInput>,
	) {
		return this.manual.prepare(ctx.user.id, input);
	}

	@Mutation({
		input: linkedinManualCompleteInput,
		meta: { permission: "outreach.approve" },
	})
	complete(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof linkedinManualCompleteInput>,
	) {
		return this.manual.complete(ctx.user.id, input);
	}

	@Mutation({
		input: linkedinManualCancelInput,
		meta: { permission: "outreach.approve" },
	})
	cancel(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof linkedinManualCancelInput>,
	) {
		return this.manual.cancel(ctx.user.id, input.id);
	}
}
