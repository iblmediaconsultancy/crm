import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { workspaceAccess, workspaceRoles } from "./access";

export const authClient = createAuthClient({
	baseURL: typeof window === "undefined" ? undefined : window.location.origin,
	plugins: [organizationClient({ ac: workspaceAccess, roles: workspaceRoles })],
});

export const { getSession, signIn, signOut, useSession } = authClient;

export type AuthClient = typeof authClient;
