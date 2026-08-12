import { db } from "@crm/db";
import { WORKSPACE_ID, workspaceSlug } from "@crm/db/workspace";

export { WORKSPACE_ID };

export const DEFAULT_WORKSPACE_NAME = "IBL Media Consultancy";

export const WORKSPACE_ROLES = ["admin", "team", "contributor"] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const WORKSPACE_PERMISSIONS = [
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
	"workspace.manage",
	"canonical.destroy",
] as const;

export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<WorkspaceRole, ReadonlySet<WorkspacePermission>> = {
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
	]),
	contributor: new Set(["crm.read", "crm.create", "crm.update.owned"]),
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
