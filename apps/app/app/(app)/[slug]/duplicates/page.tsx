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
import { DuplicatesReview } from "./duplicates-review";

export const instant = false;

export const metadata: Metadata = { title: "Duplicate review" };

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
					<PageShellTitle>Duplicate review</PageShellTitle>
					<PageShellDescription>
						Evidence-backed review with explicit survivor selection. Records are
						never auto-merged or hard-deleted.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<DuplicatesReview />
			</PageShellContent>
		</PageShell>
	);
}
