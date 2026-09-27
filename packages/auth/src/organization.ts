import { db } from "@crm/db";
import { WORKSPACE_ID } from "@crm/db/workspace";
import {
	WORKSPACE_PERMISSIONS,
	WORKSPACE_ROLES,
	type WorkspacePermission,
	type WorkspaceRole,
} from "./permissions";

export {
	FINANCE_PERMISSIONS,
	type FinancePermission,
	WORKSPACE_PERMISSIONS,
	WORKSPACE_ROLES,
	type WorkspacePermission,
	type WorkspaceRole,
} from "./permissions";
export { WORKSPACE_ID };

export const DEFAULT_WORKSPACE_NAME = "IBL Media Consultancy";

const ROLE_PERMISSIONS: Record<
	WorkspaceRole,
	ReadonlySet<WorkspacePermission>
> = {
	admin: new Set(WORKSPACE_PERMISSIONS),
	team: new Set([
		"crm.read",
		"crm.create",
		"crm.update.shared",
		"crm.update.owned",
		"crm.archive",
		"crm.restore",
		"crm.bulk.assign",
		"football.manage",
		"allocation.manage",
		"duplicates.review",
		"outreach.approve",
		"providers.verify",
		"finance.company.mrr",
		"finance.goals.read",
		"finance.pipeline.value",
		"finance.team.performance.own",
		"finance.compensation.own",
	]),
	contributor: new Set([
		"crm.read",
		"crm.create",
		"crm.update.owned",
		"finance.team.performance.own",
		"finance.compensation.own",
	]),
};

export function hasWorkspacePermission(
	role: WorkspaceRole,
	permission: WorkspacePermission,
): boolean {
	return ROLE_PERMISSIONS[role].has(permission);
}

export function isWorkspaceRole(value: string): value is WorkspaceRole {
	return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function isWorkspaceAdmin(role: WorkspaceRole | null): boolean {
	return role === "admin";
}

export function canRenameWorkspace(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canChangeRole(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canManageCurrency(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export async function ensureWorkspaceMembership(
	userId: string,
): Promise<string | undefined> {
	const membership = await db.member.findUnique({
		where: {
			organizationId_userId: {
				organizationId: WORKSPACE_ID,
				userId,
			},
		},
		select: {
			organizationId: true,
			user: { select: { profile: { select: { status: true } } } },
		},
	});
	return membership?.user.profile?.status === "ACTIVE"
		? membership.organizationId
		: undefined;
}
