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
	"providers.verify",
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
