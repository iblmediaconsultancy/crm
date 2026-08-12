import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { AllocationConsole } from "./allocation-console";

export const instant = false;

export const metadata: Metadata = { title: "Allocation" };

export default async function Page({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	await requireSession();
	const { slug } = await params;
	const workspace = await getServerQueryClient().fetchQuery(
		getServerTrpc().workspace.get.queryOptions(),
	);
	if (workspace.viewerRole === "contributor") redirect(`/${slug}/operations`);
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Allocation</PageShellTitle>
					<PageShellDescription>
						Versioned policies, deterministic dry-runs, capacity-aware
						assignment, and explained unallocated work.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<AllocationConsole />
			</PageShellContent>
		</PageShell>
	);
}
