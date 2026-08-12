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
	memberListInput,
	removeMemberInput,
	setMemberRoleInput,
	setMemberStatusInput,
	transferAdminInput,
	updateWorkspaceInput,
} from "./workspace.contracts";
import { WorkspaceService } from "./workspace.service";

@Router({ alias: "workspace" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class WorkspaceRouter {
	constructor(
		@Inject(WorkspaceService) private readonly workspace: WorkspaceService,
	) {}

	@Query({ meta: { permission: "crm.read" } })
	async get(@Ctx() ctx: AuthedTrpcContext) {
		return this.workspace.get(ctx.user.id);
	}

	@Query({ input: memberListInput, meta: { permission: "crm.read" } })
	async members(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof memberListInput>,
	) {
		return this.workspace.members(ctx.user.id, input);
	}

	@Mutation({ input: updateWorkspaceInput, meta: { permission: "workspace.manage" } })
	async update(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof updateWorkspaceInput>,
	) {
		return this.workspace.update(ctx.user.id, input);
	}

	@Mutation({ input: setMemberRoleInput, meta: { permission: "workspace.manage" } })
	async setMemberRole(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setMemberRoleInput>,
	) {
		return this.workspace.setMemberRole(ctx.user.id, input);
	}

	@Mutation({ input: setMemberStatusInput, meta: { permission: "workspace.manage" } })
	async setMemberStatus(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setMemberStatusInput>,
	) {
		return this.workspace.setMemberStatus(ctx.user.id, input);
	}

	@Mutation({ input: removeMemberInput, meta: { permission: "workspace.manage" } })
	async removeMember(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("memberId") memberId: string,
	) {
		return this.workspace.removeMember(ctx.user.id, memberId);
	}

	@Mutation({ input: transferAdminInput, meta: { permission: "workspace.manage" } })
	async transferAdmin(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof transferAdminInput>,
	) {
		return this.workspace.transferAdmin(ctx.user.id, input);
	}
}