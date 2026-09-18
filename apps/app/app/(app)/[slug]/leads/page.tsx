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
export const instant = false;

export const metadata: Metadata = { title: "Leads" };
export default async function Page() {
	await requireSession();
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Leads</PageShellTitle>
					<PageShellDescription>
						Football relationships with stage, ownership and the next action.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<OperationsDirectory kind="leads" />
			</PageShellContent>
		</PageShell>
	);
}
