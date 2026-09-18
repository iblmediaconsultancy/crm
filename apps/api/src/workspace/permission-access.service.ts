import {
	hasWorkspacePermission,
	type WorkspacePermission,
	type WorkspaceRole,
} from "@crm/auth";
import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

const SYSTEM_OPERATOR_PERMISSIONS = new Set<WorkspacePermission>([
	"crm.read",
	"crm.create",
	"crm.update.owned",
]);

@Injectable()
export class PermissionAccessService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async can(
		userId: string,
		role: WorkspaceRole,
		permission: WorkspacePermission,
	): Promise<boolean> {
		const user = await this.db.user.findUnique({
			where: { id: userId },
			select: { kind: true },
		});
		if (user?.kind === "SYSTEM_OPERATOR") {
			return SYSTEM_OPERATOR_PERMISSIONS.has(permission);
		}

		const override = await this.db.workspacePermissionOverride.findUnique({
			where: { userId_permission: { userId, permission } },
			select: { allowed: true },
		});

		return override?.allowed ?? hasWorkspacePermission(role, permission);
	}
}
