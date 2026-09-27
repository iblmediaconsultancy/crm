import type { Metadata } from "next";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { GoogleCalendarConnection } from "./google-calendar-connection";

export const metadata: Metadata = { title: "Connections" };

export default async function ConnectionsSettingsPage() {
	await requireSession();
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	const status = await queryClient.fetchQuery(
		trpc.meetings.status.queryOptions(),
	);
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Connections</PageShellTitle>
					<PageShellDescription>
						Connect the services that support scheduling and CRM operations.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent className="grid max-w-3xl gap-4">
				<HydrateClient>
					<GoogleCalendarConnection initial={status} />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
