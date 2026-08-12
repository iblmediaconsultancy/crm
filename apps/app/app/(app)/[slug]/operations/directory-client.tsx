"use client";

import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@crm/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type Kind =
	| "players"
	| "agents"
	| "agencies"
	| "clubs"
	| "representations"
	| "leads"
	| "tasks"
	| "outreach";
type Directory = RouterOutputs["operations"]["directory"];
type Workbench = RouterOutputs["operations"]["workbench"];
type ViewRow = { key: string; name: string; detail: string; status: string };

const PAGE_SIZE = 25;
const DIRECTORY_KINDS: Kind[] = ["players", "agents", "agencies", "clubs", "representations"];
const WORKBENCH_KINDS: Kind[] = ["leads", "tasks", "outreach"];

export function OperationsDirectory({ kind }: { kind: Kind }) {
	const trpc = useTRPC();
	const [search, setSearch] = useState("");
	const q = useDeferredValue(search);
	const [page, setPage] = useState(0);
	const input = { q, take: PAGE_SIZE, skip: page * PAGE_SIZE };
	const directory = useQuery({
		...trpc.operations.directory.queryOptions(input),
		enabled: DIRECTORY_KINDS.includes(kind),
	});
	const workbench = useQuery({
		...trpc.operations.workbench.queryOptions(input),
		enabled: WORKBENCH_KINDS.includes(kind),
	});
	const rows = normalize(kind, directory.data, workbench.data);
	const loading = directory.isFetching || workbench.isFetching;

	return (
		<div className="grid gap-4">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<Input
					aria-label={`Search ${kind}`}
					placeholder={`Search ${kind.replaceAll("-", " ")}\u2026`}
					value={search}
					onChange={(event) => {
						setSearch(event.target.value);
						setPage(0);
					}}
					className="sm:max-w-sm"
				/>
				<p className="text-muted-foreground text-sm">Page {page + 1}</p>
			</div>
			<div className="overflow-hidden rounded-lg border">
				<Table>
					<TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Context</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
					<TableBody>
						{rows.map((row) => (
							<TableRow key={row.key}>
								<TableCell className="font-medium">{row.name}</TableCell>
								<TableCell className="text-muted-foreground">{row.detail}</TableCell>
								<TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
							</TableRow>
						))}
						{!loading && rows.length === 0 ? (
							<TableRow><TableCell colSpan={3} className="h-28 text-center text-muted-foreground">No records match this view.</TableCell></TableRow>
						) : null}
					</TableBody>
				</Table>
			</div>
			<div className="flex justify-end gap-2">
				<Button variant="outline" disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)}>Previous</Button>
				<Button variant="outline" disabled={rows.length < PAGE_SIZE || loading} onClick={() => setPage((value) => value + 1)}>Next</Button>
			</div>
		</div>
	);
}

function normalize(kind: Kind, directory?: Directory, workbench?: Workbench): ViewRow[] {
	if (kind === "players") return (directory?.players ?? []).map((row) => ({ key: row.contactId, name: [row.contact.firstName, row.contact.lastName].filter(Boolean).join(" "), detail: row.position ?? "Position not recorded", status: "PLAYER" }));
	if (kind === "agents") return (directory?.agents ?? []).map((row) => ({ key: row.contactId, name: [row.contact.firstName, row.contact.lastName].filter(Boolean).join(" "), detail: row.agency?.company.name ?? "Independent", status: "AGENT" }));
	if (kind === "agencies") return (directory?.agencies ?? []).map((row) => ({ key: row.companyId, name: row.company.name, detail: `${row._count.agents} football agents`, status: "AGENCY" }));
	if (kind === "clubs") return (directory?.clubs ?? []).map((row) => ({ key: row.companyId, name: row.company.name, detail: `${row._count.players} players`, status: "CLUB" }));
	if (kind === "representations") return (directory?.representations ?? []).map((row) => ({ key: row.id, name: `${row.player.firstName} \u2192 ${row.agent.firstName}`, detail: row.agency?.name ?? "No agency", status: row.status }));
	if (kind === "leads") return (workbench?.leads ?? []).map((row) => ({ key: row.id, name: row.name, detail: row.owner.name, status: row.status }));
	if (kind === "tasks") return (workbench?.tasks ?? []).map((row) => ({ key: row.id, name: row.title, detail: row.assignee.name, status: row.status }));
	return (workbench?.drafts ?? []).map((row) => ({ key: row.id, name: row.subject ?? "Untitled draft", detail: row.outreachApproval ? "Approval requested" : "Draft", status: row.status }));
}