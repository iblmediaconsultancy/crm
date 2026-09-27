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
import { ArchivedRecords } from "./archived-records";

export const instant = false;

export const metadata: Metadata = { title: "Archived records" };
export default async function ArchivedPage() {
	await requireSession();
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Archived records</PageShellTitle>
					<PageShellDescription>
						Canonical records retained with their history. Open a record to
						review or restore it.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<ArchivedRecords />
			</PageShellContent>
		</PageShell>
	);
}
