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
import { ProtectedPlayersForm } from "./protected-players-form";

export const metadata: Metadata = { title: "Protected players" };

export default async function ProtectedPlayersPage() {
	await requireSession();
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(
		trpc.operations.playerProtections.queryOptions(),
	);

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Protected players</PageShellTitle>
					<PageShellDescription>
						Keep current IBL clients out of new-player prospecting while leaving
						agency and roster conversations available for review.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<HydrateClient>
					<ProtectedPlayersForm />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
