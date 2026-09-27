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

export const metadata: Metadata = { title: "Representations" };
export default async function Page() {
	await requireSession();
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Representations</PageShellTitle>
					<PageShellDescription>
						Current and historical player-agent-agency relationships.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<OperationsDirectory kind="representations" />
			</PageShellContent>
		</PageShell>
	);
}
