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
import { MailboxVerification } from "./mailbox-verification";

export const metadata: Metadata = { title: "Provider Status" };

export default async function ProviderStatusPage() {
	await requireSession();
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	const [capabilities, operations] = await Promise.all([
		queryClient.fetchQuery(trpc.providerCapabilities.get.queryOptions()),
		queryClient.fetchQuery(trpc.providerCapabilities.operations.queryOptions()),
	]);
	const mailboxRows = await queryClient.fetchQuery(
		trpc.providerCapabilities.mailboxVerification.queryOptions(),
	);
	const workspace = await queryClient.fetchQuery(
		trpc.workspace.get.queryOptions(),
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
				<Card>
					<CardHeader>
						<CardTitle>Operational state</CardTitle>
						<CardDescription>
							Redacted local counters; no message content or credentials.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-wrap gap-2">
						{operations.miabSyncs.map((row) => (
							<Badge key={`miab-${row.status}`} variant="outline">
								MIAB {row.status}: {row.count}
							</Badge>
						))}
						{operations.outboundDeliveries.map((row) => (
							<Badge key={`outbound-${row.status}`} variant="outline">
								Outbound {row.status}: {row.count}
							</Badge>
						))}
						{operations.miabSyncs.length +
							operations.outboundDeliveries.length ===
						0 ? (
							<span className="text-muted-foreground text-sm">
								No provider operations recorded.
							</span>
						) : null}
					</CardContent>
				</Card>
				<MailboxVerification
					mailbox={
						mailboxRows[0]
							? {
									...mailboxRows[0],
									verifiedAt: mailboxRows[0].verifiedAt,
								}
							: null
					}
					canVerify={
						workspace.viewerRole === "admin" || workspace.viewerRole === "team"
					}
				/>
			</PageShellContent>
		</PageShell>
	);
}
