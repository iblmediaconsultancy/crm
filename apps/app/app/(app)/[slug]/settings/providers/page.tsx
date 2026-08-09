import { Badge } from "@crm/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import type { Metadata } from "next";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
export const instant = false;

import { requireSession } from "@/lib/session";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";

export const metadata: Metadata = { title: "Provider Status" };

export default async function ProviderStatusPage() {
	await requireSession();
	const capabilities = await getServerQueryClient().fetchQuery(
		getServerTrpc().providerCapabilities.get.queryOptions(),
	);
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Provider Status</PageShellTitle>
					<PageShellDescription>
						Phase 0 provider proof remains a production gate and cannot be
						changed here.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent className="grid max-w-3xl gap-4">
				{capabilities.map((capability) => (
					<Card key={capability.key}>
						<CardHeader>
							<CardTitle>{capability.key}</CardTitle>
							<CardDescription>Read-only capability state</CardDescription>
						</CardHeader>
						<CardContent>
							<Badge variant="outline">{capability.status}</Badge>
						</CardContent>
					</Card>
				))}
			</PageShellContent>
		</PageShell>
	);
}
