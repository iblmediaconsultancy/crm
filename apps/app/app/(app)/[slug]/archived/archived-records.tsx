"use client";

import { Badge } from "@crm/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { useTRPC } from "@/lib/trpc/client";

const base = {
	q: "",
	sort: "archivedAt",
	dir: "desc" as const,
	page: 1,
	pageSize: 100,
	lifecycle: "ARCHIVED" as const,
};
export function ArchivedRecords() {
	const trpc = useTRPC();
	const open = useOpenRecord();
	const contacts = useQuery(
		trpc.contacts.list.queryOptions({
			...base,
			owner: "all",
			company: "all",
			source: "all",
		}),
	);
	const companies = useQuery(
		trpc.companies.list.queryOptions({
			...base,
			owner: "all",
			industry: "all",
			enrichment: "all",
			source: "all",
		}),
	);
	const deals = useQuery(
		trpc.deals.list.queryOptions({
			...base,
			status: "all",
			owner: "all",
			stage: "all",
			closing: "all",
		}),
	);
	return (
		<div className="grid gap-4 lg:grid-cols-3">
			<Collection title="Contacts" count={contacts.data?.total ?? 0}>
				{contacts.data?.rows.map((row) => (
					<RecordRow
						key={row.id}
						title={[row.firstName, row.lastName].filter(Boolean).join(" ")}
						reason={row.archiveReason}
						onOpen={() => open({ kind: "contact", id: row.id })}
					/>
				))}
			</Collection>
			<Collection title="Companies" count={companies.data?.total ?? 0}>
				{companies.data?.rows.map((row) => (
					<RecordRow
						key={row.id}
						title={row.name}
						reason={row.archiveReason}
						onOpen={() => open({ kind: "company", id: row.id })}
					/>
				))}
			</Collection>
			<Collection title="Deals" count={deals.data?.total ?? 0}>
				{deals.data?.rows.map((row) => (
					<RecordRow
						key={row.id}
						title={row.name}
						reason={row.archiveReason}
						onOpen={() => open({ kind: "deal", id: row.id })}
					/>
				))}
			</Collection>
		</div>
	);
}
function Collection({
	title,
	count,
	children,
}: {
	title: string;
	count: number;
	children: React.ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle>{title}</CardTitle>
					<Badge variant="secondary">{count}</Badge>
				</div>
				<CardDescription className="block">
					Retained outside active workflows
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-2">
				{children}
				<p className="hidden only:block text-sm text-muted-foreground">
					No archived {title.toLowerCase()}.
				</p>
			</CardContent>
		</Card>
	);
}
function RecordRow({
	title,
	reason,
	onOpen,
}: {
	title: string;
	reason: string | null;
	onOpen: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="grid w-full gap-1 rounded-md border p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<span className="truncate font-medium text-sm">{title}</span>
			<span className="line-clamp-2 text-muted-foreground text-xs">
				{reason ?? "No archive reason recorded"}
			</span>
		</button>
	);
}
