import {
	hasWorkspacePermission,
	type WorkspacePermission,
	type WorkspaceRole,
} from "@crm/auth";
import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

@Injectable()
export class PermissionAccessService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async can(
		userId: string,
		role: WorkspaceRole,
		permission: WorkspacePermission,
	): Promise<boolean> {
		const override = await this.db.workspacePermissionOverride.findUnique({
			where: { userId_permission: { userId, permission } },
			select: { allowed: true },
		});

		return override?.allowed ?? hasWorkspacePermission(role, permission);
	}
}
