import { organizationClient } from "better-auth/client/plugins";
import { workspaceAccess, workspaceRoles } from "./access";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: typeof window === "undefined" ? undefined : window.location.origin,
	plugins: [organizationClient({ ac: workspaceAccess, roles: workspaceRoles })],
});

export const { getSession, signIn, signOut, useSession } = authClient;

export type AuthClient = typeof authClient;
