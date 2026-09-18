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
import { AtlasOperationsSummary } from "../atlas-operations-summary";
import { OperationsDirectory } from "../operations/directory-client";
import { OutreachLifecycleControls } from "./outreach-lifecycle-controls";
import { OutreachWorkbench } from "./outreach-workbench";
export const instant = false;

export const metadata: Metadata = { title: "Outreach" };
export default async function Page() {
	await requireSession();
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Outreach</PageShellTitle>
					<PageShellDescription>
						Monitor Atlas conversations, handoffs, follow-ups and human
						approvals.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<AtlasOperationsSummary mode="outreach" />
				<details className="group rounded-lg border">
					<summary className="cursor-pointer list-none px-4 py-3 font-medium text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:px-6">
						Manual approval workspace
					</summary>
					<div className="grid gap-6 border-t p-4 md:p-6">
						<p className="text-muted-foreground text-sm">
							Use this only when reviewing research, editing a draft, approving
							a send or scheduling a follow-up.
						</p>
						<OutreachWorkbench />
						<OutreachLifecycleControls />
						<OperationsDirectory kind="outreach" />
					</div>
				</details>
			</PageShellContent>
		</PageShell>
	);
}
