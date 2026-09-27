const DEFAULT_WORKSPACE_NAME = "CRM";

export function workspaceLabel(name: string | undefined): string {
	const trimmed = name?.trim();

	if (!trimmed || trimmed === DEFAULT_WORKSPACE_NAME) return "CRM";

	return /\bcrm$/i.test(trimmed) ? trimmed : `${trimmed} CRM`;
}
