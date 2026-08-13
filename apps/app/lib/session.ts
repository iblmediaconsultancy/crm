import { ensureWorkspaceMembership, type Session } from "@crm/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL } from "@/lib/env";

export async function getSession(): Promise<Session | null> {
	const cookie = (await headers()).get("cookie");
	if (!cookie) return null;

	const response = await fetch(`${API_URL}/api/auth/get-session`, {
		headers: { cookie },
		cache: "no-store",
	});
	if (!response.ok) return null;

	return (await response.json()) as Session | null;
}

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
