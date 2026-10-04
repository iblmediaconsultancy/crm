import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { OutreachLifecycleService } from "../providers/outreach-lifecycle.service";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { PermissionMiddleware } from "../trpc/middlewares/permission.middleware";
import {
	atlasAuthorizationIssueInput,
	atlasAuthorizationRevokeInput,
	followUpCancelInput,
	followUpCohortPrepareInput,
	followUpPlanCreateInput,
	localReplyInput,
	routeConsentInput,
} from "./outreach.contracts";

@Router({ alias: "outreachLifecycle" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class OutreachLifecycleRouter {
	constructor(
		private readonly outreach: OutreachLifecycleService,
		private readonly agentTrigger: AgentTriggerService,
	) {}
	@Query({ meta: { permission: "outreach.approve" } })
	previewFollowUpCohort(@Ctx() ctx: AuthedTrpcContext) {
		return this.outreach.previewFollowUpCohort({
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
	}
	@Query({ meta: { permission: "outreach.approve" } })
	listFollowUpExecutionCohorts(@Ctx() ctx: AuthedTrpcContext) {
		return this.outreach.listFollowUpExecutionCohorts({
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
	}
	@Mutation({
		input: followUpCohortPrepareInput,
		meta: { permission: "outreach.approve" },
	})
	prepareFollowUpExecutionCohort(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof followUpCohortPrepareInput>,
	) {
		return this.outreach.prepareFollowUpExecutionCohort(
			{ userId: ctx.user.id, role: ctx.workspaceRole },
			input.stepIds,
		);
	}
	@Query({ meta: { permission: "outreach.approve" } })
	atlasSystemReadiness(@Ctx() ctx: AuthedTrpcContext) {
		return this.outreach.atlasSystemReadiness({
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
	}
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
	@Mutation({ meta: { permission: "outreach.approve" } })
	async dispatchAtlasOutreach(@Ctx() ctx: AuthedTrpcContext) {
		const task = await this.outreach.dispatchAtlasOutreach({
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
		this.agentTrigger.atlasOutreachQueued();
		return task;
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
