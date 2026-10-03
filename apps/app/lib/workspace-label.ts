import { DEFAULT_WORKSPACE_NAME } from "@crm/auth/workspace-name";

export function workspaceLabel(name: string | undefined): string {
	const trimmed = name?.trim();

	if (!trimmed || trimmed === DEFAULT_WORKSPACE_NAME) return "CRM";

	return /\bcrm$/i.test(trimmed) ? trimmed : `${trimmed} CRM`;
}
