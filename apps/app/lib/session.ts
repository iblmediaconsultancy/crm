import { auth, ensureWorkspaceMembership, type Session } from "@crm/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

export const getSession = cache(
	async (): Promise<Session | null> =>
		auth.api.getSession({ headers: await headers() }),
);

export async function requireSession(): Promise<Session> {
	const session = await getSession();

	if (!session) {
		redirect("/sign-in");
	}
	const workspaceId = await ensureWorkspaceMembership(session.user.id);
	if (!workspaceId) {
		redirect("/sign-in?error=workspace-access-inactive");
	}

	return session;
}

export async function requireMailboxAccess(): Promise<Session> {
	return requireSession();
}
