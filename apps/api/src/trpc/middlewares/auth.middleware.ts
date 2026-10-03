import { isWorkspaceRole } from "@crm/auth";
import type { Db } from "@crm/db";
import { WORKSPACE_ID } from "@crm/db/workspace";
import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";
import { InjectDatabase } from "../../database/database.constants";
import { runInPrincipalTransaction } from "../../database/database-context";
import { setRequestUserId } from "../../logging/request-context";
import type { AuthedTrpcContext, BaseTrpcContext } from "../context.types";

@Injectable()
export class AuthMiddleware implements TRPCMiddleware {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const ctx = opts.ctx as BaseTrpcContext;
		const user = ctx.session?.user;

		if (!user) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}

		setRequestUserId(user.id);

		const identity = await this.db.user.findUnique({
			where: { id: user.id },
			select: {
				profile: { select: { status: true } },
				members: {
					where: { organizationId: WORKSPACE_ID },
					select: { role: true },
					take: 1,
				},
			},
		});
		if (identity?.profile?.status !== "ACTIVE") {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Account is suspended.",
			});
		}
		const role = identity.members[0]?.role;
		if (!role || !isWorkspaceRole(role)) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Workspace access is inactive.",
			});
		}

		const nextCtx: AuthedTrpcContext = { ...ctx, user, workspaceRole: role };
		return runInPrincipalTransaction(
			this.db,
			{ userId: user.id, kind: "user" },
			() => opts.next({ ctx: nextCtx }),
		);
	}
}
