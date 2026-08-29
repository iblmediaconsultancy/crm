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
import { FinanceSettings } from "./finance-settings";

export const metadata: Metadata = { title: "Financials" };

export default async function FinancialSettingsPage() {
	await requireSession();
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	const workspace = await queryClient.fetchQuery(
		trpc.workspace.get.queryOptions(),
	);
	if (workspace.viewerRole !== "admin") redirect("../");
	await Promise.all([
		queryClient.prefetchQuery(trpc.finance.expenses.queryOptions({})),
		queryClient.prefetchQuery(trpc.finance.goals.queryOptions()),
	]);
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Financials</PageShellTitle>
					<PageShellDescription>
						Manage operating costs and the company MRR target used by the
						Command Center.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<FinanceSettings />
			</PageShellContent>
		</PageShell>
	);
}
