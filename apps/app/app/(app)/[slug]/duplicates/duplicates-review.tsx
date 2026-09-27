"use client";

import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@crm/ui/components/card";
import { Input } from "@crm/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type Side = "left" | "right";
type Preview = RouterOutputs["duplicates"]["preview"];
type Display = Preview["left"];

const FIELD_LABELS: Record<string, string> = {
	firstName: "First name", lastName: "Last name", name: "Name", email: "Email",
	phone: "Phone", title: "Title", domain: "Domain", website: "Website",
	description: "Description", industry: "Industry", city: "City", country: "Country",
	countryCode: "Country code", linkedinUrl: "LinkedIn", twitterUrl: "X / Twitter",
	githubUrl: "GitHub", companyId: "Company", ownerId: "Owner",
};

export function DuplicatesReview() {
	const trpc = useTRPC();
	const client = useQueryClient();
	const [selected, setSelected] = useState<string | null>(null);
	const [survivor, setSurvivor] = useState<Side>("left");
	const [reason, setReason] = useState("");
	const [fieldChoices, setFieldChoices] = useState<Record<string, Side>>({});
	const list = useQuery(trpc.duplicates.list.queryOptions({ q: "", take: 100 }));
	const preview = useQuery({
		...trpc.duplicates.preview.queryOptions({ candidateId: selected ?? "pending" }),
		enabled: Boolean(selected),
	});
	const refresh = async () => {
		await client.invalidateQueries();
		setSelected(null);
		setReason("");
		setFieldChoices({});
	};
	const dismiss = useMutation(trpc.duplicates.dismiss.mutationOptions({
		onSuccess: async () => { toast.success("Candidate dismissed."); await refresh(); },
		onError: (error) => toast.error(error.message),
	}));
	const merge = useMutation(trpc.duplicates.merge.mutationOptions({
		onSuccess: async () => { toast.success("Records merged and duplicate archived."); await refresh(); },
		onError: (error) => toast.error(error.message),
	}));
	const data = preview.data;
	const fields = data ? [...new Set([...Object.keys(data.left.fields), ...Object.keys(data.right.fields)])] : [];

	return (
		<div className="grid gap-4 lg:grid-cols-[minmax(18rem,.7fr)_minmax(0,1.3fr)]">
			<Card>
				<CardHeader><CardTitle>Open candidates</CardTitle></CardHeader>
				<CardContent className="grid gap-2">
					{list.data?.map((row) => (
						<button type="button" key={row.id} onClick={() => { setSelected(row.id); setFieldChoices({}); }} className="grid gap-1 rounded-md border p-3 text-left hover:bg-muted">
							<span className="font-medium">{row.left.label} \u2194 {row.right.label}</span>
							<span className="text-muted-foreground text-xs">{row.left.secondary ?? "No route"} \u00b7 {row.right.secondary ?? "No route"}</span>
							<Badge variant="outline" className="w-fit">{Math.round(Number(row.score) * 100)}% match</Badge>
						</button>
					))}
					{!list.isFetching && !list.data?.length ? <p className="py-10 text-center text-muted-foreground text-sm">No duplicate candidates need review.</p> : null}
				</CardContent>
			</Card>
			<Card>
				<CardHeader><CardTitle>Side-by-side review</CardTitle></CardHeader>
				<CardContent>
					{data ? (
						<div className="grid gap-5">
							<div className="flex flex-wrap gap-2">{data.candidate.reasons.map((reasonCode) => <Badge key={reasonCode} variant="secondary">{humanize(reasonCode)}</Badge>)}</div>
							<div className="grid gap-3 sm:grid-cols-2">
								<RecordChoice label="Left record" row={data.left} selected={survivor === "left"} onSelect={() => setSurvivor("left")} />
								<RecordChoice label="Right record" row={data.right} selected={survivor === "right"} onSelect={() => setSurvivor("right")} />
							</div>
							<div className="overflow-hidden rounded-lg border">
								<div className="grid grid-cols-[minmax(8rem,.7fr)_1fr_1fr] bg-muted/50 px-3 py-2 text-xs font-medium"><span>Field</span><span>Left</span><span>Right</span></div>
								{fields.map((field) => {
									const selectedSide = fieldChoices[field] ?? survivor;
									return <div key={field} className="grid grid-cols-[minmax(8rem,.7fr)_1fr_1fr] items-stretch border-t text-sm"><span className="px-3 py-2 text-muted-foreground">{FIELD_LABELS[field] ?? humanize(field)}</span><FieldValue value={data.left.fields[field]} selected={selectedSide === "left"} onSelect={() => setFieldChoices((current) => ({ ...current, [field]: "left" }))} /><FieldValue value={data.right.fields[field]} selected={selectedSide === "right"} onSelect={() => setFieldChoices((current) => ({ ...current, [field]: "right" }))} /></div>;
								})}
							</div>
							<Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required merge or dismissal reason" />
							<p className="rounded-md border bg-muted/40 p-3 text-muted-foreground text-xs">Merge moves linked CRM and football history transactionally, keeps mailbox and DNC boundaries, archives the duplicate, and writes a survivor alias and tombstone. The source record is not hard-deleted.</p>
							<div className="flex flex-wrap justify-end gap-2">
								<Button variant="outline" disabled={reason.trim().length < 3 || dismiss.isPending} onClick={() => dismiss.mutate({ candidateId: data.candidate.id, reason })}>Not a duplicate</Button>
								<Button disabled={reason.trim().length < 3 || merge.isPending} onClick={() => merge.mutate({ candidateId: data.candidate.id, survivorSide: survivor, reason, idempotencyKey: crypto.randomUUID(), fieldChoices })}>Merge; keep {data[survivor].label}</Button>
							</div>
						</div>
					) : <p className="py-16 text-center text-muted-foreground text-sm">Choose a candidate to compare records.</p>}
				</CardContent>
			</Card>
		</div>
	);
}

function RecordChoice({ label, row, selected, onSelect }: { label: string; row: Display; selected: boolean; onSelect: () => void }) {
	return <button type="button" onClick={onSelect} className={`grid gap-2 rounded-lg border p-4 text-left ${selected ? "border-foreground ring-1 ring-foreground" : ""}`}><span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</span><span className="font-semibold">{row.label}</span><span className="text-muted-foreground text-xs">{Object.values(row.relationshipCounts).reduce((sum, count) => sum + count, 0)} linked records retained</span><Badge variant={selected ? "default" : "outline"} className="w-fit">{selected ? "Default survivor" : "Select as survivor"}</Badge></button>;
}

function FieldValue({ value, selected, onSelect }: { value: string | null | undefined; selected: boolean; onSelect: () => void }) {
	return <button type="button" onClick={onSelect} className={`min-w-0 border-l px-3 py-2 text-left ${selected ? "bg-primary/8 font-medium" : "hover:bg-muted"}`}><span className="line-clamp-2 break-words">{value || "Not recorded"}</span></button>;
}

function humanize(value: string) { return value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(); }