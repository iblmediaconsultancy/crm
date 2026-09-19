import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
import { LeadDetail } from "./lead-detail";

export const metadata: Metadata = { title: "Lead" };
export const instant = false;

export default async function LeadPage({
	params,
}: {
	params: Promise<{ leadId: string }>;
}) {
	await requireSession();
	const { leadId } = await params;
	const queryClient = getServerQueryClient();
	const trpc = getServerTrpc();

	try {
		await queryClient.fetchQuery(
			trpc.operations.leadById.queryOptions({ id: leadId }),
		);
	} catch {
		notFound();
	}

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Lead detail</PageShellTitle>
					<PageShellDescription>
						The full relationship record, imported history and next action.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<HydrateClient>
					<LeadDetail leadId={leadId} />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
