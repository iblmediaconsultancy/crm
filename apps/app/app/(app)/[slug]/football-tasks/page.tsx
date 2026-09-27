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

export const metadata: Metadata = { title: "Tasks" };
export default async function Page() {
	await requireSession();
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Tasks</PageShellTitle>
					<PageShellDescription>
						Assigned football CRM work with due-state visibility.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<OperationsDirectory kind="tasks" />
			</PageShellContent>
		</PageShell>
	);
}
