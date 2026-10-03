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
	acceptInvitationInput,
	invitationIdInput,
	inviteMemberInput,
	pendingInvitationsInput,
} from "./onboarding.contracts";
import { OnboardingService } from "./onboarding.service";

@Router({ alias: "onboarding" })
export class OnboardingRouter {
	constructor(
		@Inject(OnboardingService) private readonly onboarding: OnboardingService,
	) {}

	@Query({ input: invitationIdInput })
	invitation(@Input("invitationId") invitationId: string) {
		return this.onboarding.invitation(invitationId);
	}

	@Mutation({ input: acceptInvitationInput })
	accept(@Input() input: z.infer<typeof acceptInvitationInput>) {
		return this.onboarding.accept(input);
	}

	@Query({
		input: pendingInvitationsInput,
		meta: { permission: "workspace.manage" },
	})
	@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
	pending(@Input() input: z.infer<typeof pendingInvitationsInput>) {
		return this.onboarding.pending(input);
	}

	@Mutation({
		input: inviteMemberInput,
		meta: { permission: "workspace.manage" },
	})
	@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
	invite(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof inviteMemberInput>,
	) {
		return this.onboarding.invite(ctx.user.id, input);
	}

	@Mutation({
		input: invitationIdInput,
		meta: { permission: "workspace.manage" },
	})
	@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
	resend(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("invitationId") invitationId: string,
	) {
		return this.onboarding.resend(ctx.user.id, invitationId);
	}
	@Mutation({
		input: invitationIdInput,
		meta: { permission: "workspace.manage" },
	})
	@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
	cancel(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("invitationId") invitationId: string,
	) {
		return this.onboarding.cancel(ctx.user.id, invitationId);
	}
}
