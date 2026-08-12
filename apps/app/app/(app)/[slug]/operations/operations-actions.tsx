"use client";

import { Button } from "@crm/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@crm/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Textarea } from "@crm/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

const selectClass = "border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Failure = { message: string };

export function OperationsActions({ viewerRole, viewerUserId }: { viewerRole: "admin" | "team" | "contributor" | null; viewerUserId: string }) {
	const trpc = useTRPC();
	const router = useRouter();
	const selectors = useQuery(trpc.operations.selectors.queryOptions({ q: "", take: 100, skip: 0 }));
	const [profileKind, setProfileKind] = useState<"PLAYER" | "FOOTBALL_AGENT">("PLAYER");
	const done = (message: string) => { toast.success(message); router.refresh(); void selectors.refetch(); };
	const failed = (error: Failure) => toast.error(error.message);
	const profile = useMutation(trpc.operations.saveFootballProfile.mutationOptions({ onSuccess: () => done("Football profile saved."), onError: failed }));
	const representation = useMutation(trpc.operations.createRepresentation.mutationOptions({ onSuccess: () => done("Representation created."), onError: failed }));
	const task = useMutation(trpc.operations.createTask.mutationOptions({ onSuccess: () => done("Task created."), onError: failed }));
	const draft = useMutation(trpc.operations.createDraft.mutationOptions({ onSuccess: () => done("Draft saved."), onError: failed }));
	const lead = useMutation(trpc.operations.createLead.mutationOptions({ onSuccess: () => done("Lead created."), onError: failed }));
	const decide = useMutation(trpc.operations.decideApproval.mutationOptions({ onSuccess: () => done("Approval decision recorded."), onError: failed }));
	const data = selectors.data;
	const players = data?.contacts.filter((row) => row.playerProfile) ?? [];
	const agents = data?.contacts.filter((row) => row.footballAgentProfile) ?? [];
	const canManage = viewerRole === "admin" || viewerRole === "team";
	const assignableMembers = canManage ? (data?.members ?? []) : (data?.members ?? []).filter((row) => row.userId === viewerUserId);
	return (
		<section aria-labelledby="record-actions" className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
			<h2 id="record-actions" className="sr-only">Record actions</h2>
			<ActionCard hidden={!canManage} title="Football profile" description="Promote an active CRM contact without copying an internal ID.">
				<form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); profile.mutate({ contactId: String(form.get("contact")), kind: profileKind, position: profileKind === "PLAYER" ? String(form.get("detail") || "") || null : undefined, licenseNumber: profileKind === "FOOTBALL_AGENT" ? String(form.get("detail") || "") || null : undefined }); }}>
					<FieldGroup><SelectField label="Contact" name="contact" options={(data?.contacts ?? []).map((row) => ({ value: row.id, label: contactLabel(row) }))} /><Field><FieldLabel>Profile type</FieldLabel><select className={selectClass} value={profileKind} onChange={(event) => setProfileKind(event.target.value as typeof profileKind)}><option value="PLAYER">Player</option><option value="FOOTBALL_AGENT">Football agent</option></select></Field><Field><FieldLabel>{profileKind === "PLAYER" ? "Position" : "Licence number"}</FieldLabel><Input name="detail" /></Field><Button type="submit" disabled={!data || profile.isPending}>Save profile</Button></FieldGroup>
				</form>
			</ActionCard>
			<ActionCard hidden={!canManage} title="Representation" description="Link an active player and football agent with durable history.">
				<form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); representation.mutate({ playerContactId: String(form.get("player")), agentContactId: String(form.get("agent")), status: "PENDING", reason: String(form.get("reason")) }); }}>
					<FieldGroup><SelectField label="Player" name="player" options={players.map((row) => ({ value: row.id, label: contactLabel(row) }))} /><SelectField label="Football agent" name="agent" options={agents.map((row) => ({ value: row.id, label: contactLabel(row) }))} /><Field><FieldLabel>Reason</FieldLabel><Input name="reason" required /></Field><Button type="submit" disabled={representation.isPending || players.length === 0 || agents.length === 0}>Create representation</Button></FieldGroup>
				</form>
			</ActionCard>
			<ActionCard title="Task" description="Assign linked work to an active workspace member.">
				<form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); task.mutate({ title: String(form.get("title")), assigneeUserId: String(form.get("assignee")), contactId: String(form.get("contact")) || null, priority: "NORMAL" }); }}>
					<FieldGroup><Field><FieldLabel>Task title</FieldLabel><Input name="title" required /></Field><SelectField label="Assignee" name="assignee" options={assignableMembers.map((row) => ({ value: row.userId, label: `${row.user.name} · ${row.role}` }))} /><SelectField label="Contact" name="contact" optional options={(data?.contacts ?? []).map((row) => ({ value: row.id, label: contactLabel(row) }))} /><Button type="submit" disabled={!data || task.isPending}>Create task</Button></FieldGroup>
				</form>
			</ActionCard>
			<ActionCard title="Outreach draft" description="Draft to an accessible route; sending remains queued and separately approved.">
				<form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); draft.mutate({ mailboxId: String(form.get("mailbox")) || null, recipientRouteId: String(form.get("route")) || null, subject: String(form.get("subject")) || null, body: String(form.get("body")), idempotencyKey: crypto.randomUUID() }); }}>
					<FieldGroup><SelectField label="Mailbox" name="mailbox" optional options={(data?.mailboxes ?? []).map((row) => ({ value: row.id, label: row.displayName ? `${row.displayName} · ${row.address}` : row.address }))} /><SelectField label="Recipient route" name="route" options={(data?.routes ?? []).map((row) => ({ value: row.id, label: routeLabel(row) }))} /><Field><FieldLabel>Subject</FieldLabel><Input name="subject" /></Field><Field><FieldLabel>Body</FieldLabel><Textarea name="body" required rows={4} /></Field><Button type="submit" disabled={!data || draft.isPending}>Save draft</Button></FieldGroup>
				</form>
			</ActionCard>
			<ActionCard title="Lead" description="Create pipeline intake against an active CRM contact and owner.">
				<form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); lead.mutate({ name: String(form.get("name")), contactId: String(form.get("contact")) || null, ownerUserId: String(form.get("owner")) }); }}>
					<FieldGroup><Field><FieldLabel>Lead name</FieldLabel><Input name="name" required /></Field><SelectField label="Contact" name="contact" optional options={(data?.contacts ?? []).map((row) => ({ value: row.id, label: contactLabel(row) }))} /><SelectField label="Owner" name="owner" options={assignableMembers.map((row) => ({ value: row.userId, label: `${row.user.name} · ${row.role}` }))} /><Button type="submit" disabled={!data || lead.isPending}>Create lead</Button></FieldGroup>
				</form>
			</ActionCard>
			<ActionCard hidden={!canManage} title="Approval queue" description="Team or Admin reviewers decide another person’s pending request.">
				<form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); decide.mutate({ id: String(form.get("approval")), status: String(form.get("decision")) as "APPROVED" | "REJECTED", reason: String(form.get("reason")) }); }}>
					<FieldGroup><SelectField label="Pending request" name="approval" options={(data?.approvals ?? []).map((row) => ({ value: row.id, label: `${row.draft.subject ?? "Untitled draft"} · ${row.requestedBy.name}` }))} /><Field><FieldLabel>Decision</FieldLabel><select name="decision" className={selectClass}><option value="APPROVED">Approve</option><option value="REJECTED">Reject</option></select></Field><Field><FieldLabel>Reason</FieldLabel><Textarea name="reason" required rows={3} /></Field><Button type="submit" disabled={!data || decide.isPending || (data?.approvals.length ?? 0) === 0}>Record decision</Button></FieldGroup>
				</form>
			</ActionCard>
		</section>
	);
}

function ActionCard({ title, description, children, hidden = false }: { title: string; description: string; children: React.ReactNode; hidden?: boolean }) { if (hidden) return null; return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription className="block">{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>; }
function SelectField({ label, name, options, optional = false }: { label: string; name: string; options: { value: string; label: string }[]; optional?: boolean }) { return <Field><FieldLabel>{label}</FieldLabel><select aria-label={label} className={selectClass} name={name} required={!optional}><option value="">{optional ? `No ${label.toLowerCase()}` : `Select ${label.toLowerCase()}`}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>; }
function contactLabel(row: { firstName: string; lastName: string | null; email: string | null }) { return `${[row.firstName, row.lastName].filter(Boolean).join(" ")}${row.email ? ` · ${row.email}` : ""}`; }
function routeLabel(row: { type: string; value: string; label: string | null; contact: { firstName: string; lastName: string | null } | null; company: { name: string } | null }) { const owner = row.contact ? [row.contact.firstName, row.contact.lastName].filter(Boolean).join(" ") : row.company?.name; return `${row.label ?? row.type} · ${owner ?? row.value}`; }