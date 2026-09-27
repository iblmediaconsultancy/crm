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

export const metadata: Metadata = { title: "Agencies" };
export default async function Page() {
	await requireSession();
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Agencies</PageShellTitle>
					<PageShellDescription>
						Football agencies, their agents, and relationship context.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<OperationsDirectory kind="agencies" />
			</PageShellContent>
		</PageShell>
	);
}
