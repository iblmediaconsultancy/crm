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
						Draft, independent approval, DNC, delivery, provider-event, reply,
						and follow-up lifecycle.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<OutreachWorkbench />
				<OutreachLifecycleControls />
				<OperationsDirectory kind="outreach" />
			</PageShellContent>
		</PageShell>
	);
}
