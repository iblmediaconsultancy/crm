import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

export const workspaceAccess = createAccessControl(defaultStatements);

export const workspaceRoles = {
	admin: workspaceAccess.newRole({
		organization: ["update"],
		member: [],
		invitation: [],
		team: ["create", "update", "delete"],
		ac: ["read"],
	}),
	team: workspaceAccess.newRole({
		organization: [],
		member: [],
		invitation: [],
		team: [],
		ac: ["read"],
	}),
	contributor: workspaceAccess.newRole({
		organization: [],
		member: [],
		invitation: [],
		team: [],
		ac: ["read"],
	}),
} as const;
