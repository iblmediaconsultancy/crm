import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import { OutreachLifecycleService } from "../providers/outreach-lifecycle.service";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { PermissionMiddleware } from "../trpc/middlewares/permission.middleware";
import {
	atlasAuthorizationIssueInput,
	atlasAuthorizationRevokeInput,
	followUpCancelInput,
	followUpPlanCreateInput,
	localReplyInput,
	routeConsentInput,
} from "./outreach.contracts";

@Router({ alias: "outreachLifecycle" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class OutreachLifecycleRouter {
	constructor(private readonly outreach: OutreachLifecycleService) {}
	@Query({ meta: { permission: "outreach.approve" } }) listAtlasAuthorizations(
		@Ctx() ctx: AuthedTrpcContext,
	) {
		return this.outreach.listAtlasAuthorizations({
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
	}
	@Mutation({
		input: atlasAuthorizationIssueInput,
		meta: { permission: "outreach.approve" },
	})
	issueAtlasAuthorization(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof atlasAuthorizationIssueInput>,
	) {
		return this.outreach.issueAtlasAuthorization(
			{ userId: ctx.user.id, role: ctx.workspaceRole },
			input,
		);
	}
	@Mutation({
		input: atlasAuthorizationRevokeInput,
		meta: { permission: "outreach.approve" },
	})
	revokeAtlasAuthorization(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof atlasAuthorizationRevokeInput>,
	) {
		return this.outreach.revokeAtlasAuthorization(
			{ userId: ctx.user.id, role: ctx.workspaceRole },
			input,
		);
	}
	@Query({ meta: { permission: "crm.read" } }) listPlans(
		@Ctx() ctx: AuthedTrpcContext,
	) {
		return this.outreach.listPlans({
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
	}
	@Mutation({
		input: routeConsentInput,
		meta: { permission: "crm.update.owned" },
	})
	setConsent(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof routeConsentInput>,
	) {
		return this.outreach.setConsent(
			{ userId: ctx.user.id, role: ctx.workspaceRole },
			input,
		);
	}
	@Mutation({
		input: followUpPlanCreateInput,
		meta: { permission: "crm.create" },
	})
	createFollowUpPlan(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof followUpPlanCreateInput>,
	) {
		return this.outreach.createPlan(ctx.user.id, input);
	}
	@Mutation({
		input: followUpCancelInput,
		meta: { permission: "crm.update.owned" },
	})
	cancelFollowUpPlan(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof followUpCancelInput>,
	) {
		return this.outreach.cancelPlan(
			{ userId: ctx.user.id, role: ctx.workspaceRole },
			input.planId,
			input.reason,
		);
	}

	@Mutation({
		input: localReplyInput,
		meta: { permission: "crm.create" },
	})
	simulateLocalReply(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof localReplyInput>,
	) {
		return this.outreach.simulateLocalReply(
			ctx.user.id,
			input.deliveryId,
			input.body,
		);
	}
}
