import { hasWorkspacePermission, type WorkspacePermission } from "@crm/auth";
import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";
import type { AuthedTrpcContext } from "../context.types";

export type PermissionMeta = { permission?: WorkspacePermission };

@Injectable()
export class PermissionMiddleware implements TRPCMiddleware<PermissionMeta> {
	async use(
		opts: MiddlewareOptions<
			AuthedTrpcContext,
			Record<string, unknown>,
			PermissionMeta
		>,
	): Promise<MiddlewareResponse> {
		const permission = opts.meta?.permission;
		if (!permission) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "This procedure has no permission declaration.",
			});
		}
		if (!hasWorkspacePermission(opts.ctx.workspaceRole, permission)) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Insufficient workspace permission.",
			});
		}
		return opts.next();
	}
}