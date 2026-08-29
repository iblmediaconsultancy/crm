import { db } from "@crm/db";
import { WORKSPACE_ID } from "@crm/db/workspace";

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
	"finance.company.mrr",
	"finance.company.revenue",
	"finance.company.profit",
	"finance.company.costs",
	"finance.client.pricing",
	"finance.client.costs",
	"finance.pipeline.value",
	"finance.team.performance.own",
	"finance.team.performance.all",
	"finance.goals.read",
	"finance.goals.edit",
	"finance.edit",
	"finance.expenses.edit",
	"finance.permissions.edit",
	"finance.compensation.own",
	"finance.compensation.other",
] as const;

export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

export const FINANCE_PERMISSIONS = WORKSPACE_PERMISSIONS.filter(
	(value): value is Extract<WorkspacePermission, `finance.${string}`> =>
		value.startsWith("finance."),
) as [
	Extract<WorkspacePermission, `finance.${string}`>,
	...Extract<WorkspacePermission, `finance.${string}`>[],
];

export type FinancePermission = (typeof FINANCE_PERMISSIONS)[number];

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
