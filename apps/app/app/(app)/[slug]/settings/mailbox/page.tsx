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

export const metadata: Metadata = { title: "Mailbox" };

export default async function MailboxSettingsPage() {
	await requireSession();
	const mailboxes = await getServerQueryClient().fetchQuery(
		getServerTrpc().mailbox.listAccessible.queryOptions(),
	);
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Mailbox</PageShellTitle>
					<PageShellDescription>
						Mailbox identity is available for research; provider transport
						remains separately gated.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent className="grid max-w-3xl gap-4">
				{mailboxes.map((mailbox) => (
					<Card key={mailbox.id}>
						<CardHeader>
							<CardTitle>{mailbox.displayName ?? mailbox.address}</CardTitle>
							<CardDescription>{mailbox.address}</CardDescription>
						</CardHeader>
						<CardContent>
							<Badge variant="outline">{mailbox.status}</Badge>
						</CardContent>
					</Card>
				))}
				{mailboxes.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No local mailbox identity has been added.
					</p>
				) : null}
			</PageShellContent>
		</PageShell>
	);
}
