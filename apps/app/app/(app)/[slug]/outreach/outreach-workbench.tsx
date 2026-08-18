"use client";

import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Input } from "@crm/ui/components/input";
import { Textarea } from "@crm/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

const selectClass =
	"border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function OutreachWorkbench() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const workspace = useQuery(trpc.operations.outreachWorkspace.queryOptions());
	const data = workspace.data;
	const [leadId, setLeadId] = useState("");
	const [prompt, setPrompt] = useState("");
	const [draftId, setDraftId] = useState("");
	const [mailboxId, setMailboxId] = useState("");
	const [routeId, setRouteId] = useState("");
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");
	const [decisionReason, setDecisionReason] = useState("");
	const [replyBody, setReplyBody] = useState(
		"Thanks for getting back to us. This is a local acceptance reply.",
	);
	const [followUpDraftId, setFollowUpDraftId] = useState("");
	const [followUpAt, setFollowUpAt] = useState("");

	const refresh = async () => {
		await queryClient.invalidateQueries({
			queryKey: trpc.operations.outreachWorkspace.queryKey(),
		});
		await queryClient.invalidateQueries({
			queryKey: trpc.outreachLifecycle.listPlans.queryKey(),
		});
	};
	const failed = (error: { message: string }) => toast.error(error.message);
	const requestedResearch = useMutation(
		trpc.operations.requestResearch.mutationOptions({
			onSuccess: async () => {
				toast.success("AI research queued with your authenticated identity.");
				await refresh();
			},
			onError: failed,
		}),
	);
	const createDraft = useMutation(
		trpc.operations.createDraft.mutationOptions({
			onSuccess: async (draft) => {
				setDraftId(draft.id);
				toast.success("Draft saved for review.");
				await refresh();
			},
			onError: failed,
		}),
	);
	const updateDraft = useMutation(
		trpc.operations.updateDraft.mutationOptions({
			onSuccess: async () => {
				toast.success("Draft changes saved.");
				await refresh();
			},
			onError: failed,
		}),
	);
	const requestApproval = useMutation(
		trpc.operations.requestApproval.mutationOptions({
			onSuccess: async () => {
				toast.success("Independent human approval requested.");
				await refresh();
			},
			onError: failed,
		}),
	);
	const decide = useMutation(
		trpc.operations.decideApproval.mutationOptions({
			onSuccess: async () => {
				toast.success("Human approval decision recorded.");
				await refresh();
			},
			onError: failed,
		}),
	);
	const send = useMutation(
		trpc.operations.sendApprovedDraft.mutationOptions({
			onSuccess: async () => {
				toast.success("Approved message queued in PostgreSQL.");
				await refresh();
			},
			onError: failed,
		}),
	);
	const localReply = useMutation(
		trpc.outreachLifecycle.simulateLocalReply.mutationOptions({
			onSuccess: async () => {
				toast.success(
					"Local inbound reply stored; pending follow-ups were cancelled.",
				);
				await refresh();
			},
			onError: failed,
		}),
	);
	const follow = useMutation(
		trpc.outreachLifecycle.createFollowUpPlan.mutationOptions({
			onSuccess: async () => {
				toast.success("Approved follow-up scheduled in PostgreSQL.");
				await refresh();
			},
			onError: failed,
		}),
	);

	const lead = data?.leads.find((item) => item.id === leadId);
	const ownedRoutes = (lead?.contact?.contactRoutes ?? []).filter(
		(route) => route.ownerUserId === data?.viewer.userId,
	);
	const ownedMailboxes = (data?.mailboxes ?? []).filter(
		(mailbox) =>
			mailbox.ownerUserId === data?.viewer.userId &&
			mailbox.status === "VERIFIED",
	);
	const drafts = (data?.drafts ?? []).filter(
		(draft) => draft.ownerUserId === data?.viewer.userId,
	);
	const draft = drafts.find((item) => item.id === draftId);
	const research = (data?.research ?? []).filter(
		(item) => item.targetType === "LEAD" && item.targetEntityId === leadId,
	);
	const delivery = data?.deliveries.find((item) => item.draftId === draftId);
	const thread = data?.threads.find(
		(item) =>
			item.contactId === lead?.contact?.id &&
			(!mailboxId || item.mailboxId === mailboxId),
	);
	const approvedDrafts = drafts.filter(
		(item) => item.status === "APPROVED" && item.recipientRouteId === routeId,
	);
	const pendingApprovals = (data?.approvals ?? []).filter(
		(approval) =>
			approval.status === "PENDING" &&
			approval.requestedById !== data?.viewer.userId,
	);
	const canApprove =
		data?.viewer.role === "admin" || data?.viewer.role === "team";
	const parsedFollowUpAt = followUpAt
		? new Date(followUpAt.replace(" ", "T"))
		: null;
	const validFollowUpAt =
		parsedFollowUpAt && !Number.isNaN(parsedFollowUpAt.getTime());
	const followUpBlockers = [
		!lead?.contact?.id ? "lead contact" : null,
		!routeId ? "recipient route" : null,
		!followUpDraftId ? "approved draft" : null,
		!validFollowUpAt ? "valid due time (YYYY-MM-DD HH:mm)" : null,
	].filter((value): value is string => Boolean(value));

	useEffect(() => {
		if (!leadId && data?.leads[0]) setLeadId(data.leads[0].id);
	}, [data?.leads, leadId]);
	useEffect(() => {
		if (!mailboxId && ownedMailboxes[0]) setMailboxId(ownedMailboxes[0].id);
		if (!routeId && ownedRoutes[0]) setRouteId(ownedRoutes[0].id);
	}, [mailboxId, ownedMailboxes, ownedRoutes, routeId]);
	useEffect(() => {
		if (!draft) return;
		setMailboxId(draft.mailboxId ?? "");
		setRouteId(draft.recipientRouteId ?? "");
		setSubject(draft.subject ?? "");
		setBody(draft.body);
	}, [draft]);

	const latestFinding = useMemo(
		() => research.flatMap((item) => item.findings).at(-1),
		[research],
	);
	const startReply = () => {
		setDraftId("");
		setSubject(`Re: ${thread?.subject?.replace(/^Re:\s*/i, "") ?? subject}`);
		setBody("Thanks for your reply.\n\n");
	};

	return (
		<div className="grid gap-4">
			<Card>
				<CardHeader>
					<CardTitle>Outreach readiness</CardTitle>
					<CardDescription>
						Live providers remain fail-closed. The local double never contacts
						MIAB or Resend.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3 sm:grid-cols-3">
					<Readiness
						label="CRM AI"
						value={data?.readiness.agent ?? "CHECKING"}
						detail={
							data?.readiness.agent === "READY"
								? "Authenticated Eve bridge connected"
								: "Agent bridge is not configured"
						}
					/>
					<Readiness
						label="Mailbox"
						value={data?.readiness.mailbox ?? "CHECKING"}
						detail={
							ownedMailboxes.length
								? `${ownedMailboxes.length} owned verified mailbox${ownedMailboxes.length === 1 ? "" : "es"}`
								: "No owned verified mailbox"
						}
					/>
					<Readiness
						label="Sending"
						value={data?.readiness.delivery ?? "CHECKING"}
						detail={
							data?.readiness.localProviderDouble
								? "Safe local provider double"
								: "Requires verified Resend evidence"
						}
					/>
				</CardContent>
			</Card>

			<div className="grid gap-4 xl:grid-cols-2">
				<Step
					number="1"
					title="Lead and AI research"
					description="Choose a visible lead and queue scoped research as the signed-in user."
				>
					<Select
						label="Lead"
						value={leadId}
						onChange={setLeadId}
						options={(data?.leads ?? []).map((item) => ({
							value: item.id,
							label: `${item.name} · ${item.status}`,
						}))}
					/>
					<Textarea
						aria-label="Research prompt"
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						placeholder="Research this lead and propose evidence-backed outreach angles."
						rows={3}
					/>
					<Button
						disabled={
							!leadId ||
							prompt.trim().length === 0 ||
							data?.readiness.agent !== "READY" ||
							requestedResearch.isPending
						}
						onClick={() =>
							requestedResearch.mutate({
								targetType: "LEAD",
								targetEntityId: leadId,
								mailboxId: mailboxId || null,
								prompt,
								idempotencyKey: crypto.randomUUID(),
							})
						}
					>
						Run AI research
					</Button>
					{data?.readiness.agent !== "READY" ? (
						<State tone="warning">
							AI is installed but unconfigured. Set AGENT_BRIDGE_SECRET and
							start Eve; no request is sent until then.
						</State>
					) : null}
					{research.map((item) => (
						<State
							key={item.id}
							tone={item.status === "FAILED" ? "danger" : "neutral"}
						>
							<strong>{item.status}</strong> · {item.prompt}
							{item.failureCode ? ` · ${item.failureCode}` : ""}
							{item.findings.map((finding) => (
								<span className="mt-1 block" key={finding.id}>
									{finding.summary} ·{" "}
									{finding.evidenceSource.title ??
										finding.evidenceSource.locator}
								</span>
							))}
						</State>
					))}
				</Step>

				<Step
					number="2"
					title="Draft and review/edit"
					description="Use an AI-created draft or compose a new message, then edit it before approval."
				>
					<Select
						label="Editable draft"
						optional
						value={draftId}
						onChange={setDraftId}
						options={drafts.map((item) => ({
							value: item.id,
							label: `${item.subject ?? "Untitled"} · ${item.status} · ${item.owner.name}`,
						}))}
					/>
					<Select
						label="From mailbox"
						value={mailboxId}
						onChange={setMailboxId}
						options={ownedMailboxes.map((item) => ({
							value: item.id,
							label: item.displayName
								? `${item.displayName} · ${item.address}`
								: item.address,
						}))}
					/>
					<Select
						label="To route"
						value={routeId}
						onChange={setRouteId}
						options={ownedRoutes.map((item) => ({
							value: item.id,
							label: `${item.label ?? "Email"} · ${item.value}`,
						}))}
					/>
					<Input
						aria-label="Subject"
						value={subject}
						onChange={(event) => setSubject(event.target.value)}
						placeholder="Subject"
					/>
					<Textarea
						aria-label="Message body"
						value={body}
						onChange={(event) => setBody(event.target.value)}
						placeholder={
							latestFinding
								? `Use research: ${latestFinding.summary}`
								: "Write the reviewed message"
						}
						rows={8}
					/>
					<div className="flex flex-wrap gap-2">
						<Button
							disabled={
								!mailboxId ||
								!routeId ||
								!body.trim() ||
								Boolean(draft && draft.status !== "DRAFT")
							}
							onClick={() =>
								draft
									? updateDraft.mutate({
											id: draft.id,
											mailboxId,
											recipientRouteId: routeId,
											subject: subject || null,
											body,
										})
									: createDraft.mutate({
											mailboxId,
											recipientRouteId: routeId,
											subject: subject || null,
											body,
											idempotencyKey: crypto.randomUUID(),
										})
							}
						>
							{draft ? "Save edits" : "Save new draft"}
						</Button>
						<Button
							variant="outline"
							disabled={draft?.status !== "DRAFT"}
							onClick={() => {
								if (!draft) return;
								requestApproval.mutate({
									draftId: draft.id,
									idempotencyKey: crypto.randomUUID(),
								});
							}}
						>
							Submit for approval
						</Button>
					</div>
					{draft ? (
						<State tone="neutral">
							Owner: {draft.owner.name} · Draft: {draft.status} · Approval:{" "}
							{draft.outreachApproval?.status ?? "NOT REQUESTED"}
						</State>
					) : null}
				</Step>

				<Step
					number="3"
					title="Independent human approval"
					description="Only Team or Admin can decide another person’s request."
				>
					{!canApprove ? (
						<State tone="neutral">
							Waiting for a Team or Admin reviewer. You cannot approve your own
							request.
						</State>
					) : null}
					{canApprove && pendingApprovals.length === 0 ? (
						<State tone="neutral">
							No independently reviewable requests are pending.
						</State>
					) : null}
					{pendingApprovals.map((approval) => (
						<div key={approval.id} className="grid gap-2 rounded-md border p-3">
							<p className="font-medium">
								{approval.draft.subject ?? "Untitled"} ·{" "}
								{approval.requestedBy.name}
							</p>
							<p className="whitespace-pre-wrap text-sm text-muted-foreground">
								{approval.draft.body}
							</p>
							<Textarea
								aria-label="Approval reason"
								value={decisionReason}
								onChange={(event) => setDecisionReason(event.target.value)}
								placeholder="Decision reason"
								rows={2}
							/>
							<div className="flex gap-2">
								<Button
									disabled={decisionReason.trim().length === 0}
									onClick={() =>
										decide.mutate({
											id: approval.id,
											status: "APPROVED",
											reason: decisionReason,
										})
									}
								>
									Approve
								</Button>
								<Button
									variant="outline"
									disabled={decisionReason.trim().length === 0}
									onClick={() =>
										decide.mutate({
											id: approval.id,
											status: "REJECTED",
											reason: decisionReason,
										})
									}
								>
									Reject
								</Button>
							</div>
						</div>
					))}
				</Step>

				<Step
					number="4"
					title="Send"
					description="The owner queues only an independently approved draft; DNC and mailbox checks run again."
				>
					<State
						tone={data?.readiness.delivery === "READY" ? "neutral" : "warning"}
					>
						{data?.readiness.delivery === "READY"
							? "Delivery transport is ready."
							: "Sending is blocked until the real provider is verified or the local double is enabled."}
					</State>
					<Button
						disabled={
							draft?.status !== "APPROVED" ||
							data?.readiness.delivery !== "READY" ||
							send.isPending
						}
						onClick={() => {
							if (!draft) return;
							send.mutate({ draftId: draft.id });
						}}
					>
						Queue approved send
					</Button>
					{delivery ? (
						<State tone={delivery.lastErrorCode ? "danger" : "neutral"}>
							Delivery: <strong>{delivery.status}</strong>
							{delivery.lastErrorCode ? ` · ${delivery.lastErrorCode}` : ""}
						</State>
					) : null}
				</Step>

				<Step
					number="5"
					title="Thread and reply"
					description="Synced replies appear in the mailbox-scoped thread and stop pending follow-ups."
				>
					{thread ? (
						<State tone="neutral">
							<strong>{thread.subject ?? "No subject"}</strong> ·{" "}
							{thread.messageCount} message
							{thread.messageCount === 1 ? "" : "s"}
							<span className="mt-1 block whitespace-pre-wrap">
								{thread.messages[0]?.body ?? thread.messages[0]?.snippet}
							</span>
						</State>
					) : (
						<State tone="neutral">
							No thread has been synced for this lead yet.
						</State>
					)}
					{data?.readiness.localProviderDouble &&
					delivery &&
					["SENT", "DELIVERED"].includes(delivery.status) ? (
						<>
							<Textarea
								aria-label="Local reply body"
								value={replyBody}
								onChange={(event) => setReplyBody(event.target.value)}
								rows={3}
							/>
							<Button
								variant="outline"
								onClick={() =>
									localReply.mutate({
										deliveryId: delivery.id,
										body: replyBody,
									})
								}
							>
								Simulate local inbound reply
							</Button>
						</>
					) : null}
					<Button variant="outline" disabled={!thread} onClick={startReply}>
						Compose reviewed reply
					</Button>
				</Step>

				<Step
					number="6"
					title="Follow-up"
					description="Every scheduled step needs its own independently approved draft."
				>
					<Select
						label="Approved follow-up draft"
						value={followUpDraftId}
						onChange={setFollowUpDraftId}
						options={approvedDrafts.map((item) => ({
							value: item.id,
							label: item.subject ?? "Untitled",
						}))}
					/>
					<Input
						aria-label="Follow-up due at"
						value={followUpAt}
						onChange={(event) => setFollowUpAt(event.target.value)}
						placeholder="YYYY-MM-DD HH:mm"
					/>
					<Button
						disabled={followUpBlockers.length > 0}
						onClick={() => {
							if (!lead?.contact || !parsedFollowUpAt) return;
							follow.mutate({
								contactId: lead.contact.id,
								routeId,
								steps: [{ draftId: followUpDraftId, dueAt: parsedFollowUpAt }],
							});
						}}
					>
						Schedule approved follow-up
					</Button>
					{followUpBlockers.length ? (
						<State tone="warning">
							Missing: {followUpBlockers.join(", ")}.
						</State>
					) : null}
				</Step>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Audit history</CardTitle>
					<CardDescription>
						Actor, action, outcome, and time for research and outreach changes.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-2">
					{data?.audit.length ? (
						data.audit.map((event) => (
							<div
								key={event.id}
								className="flex flex-col justify-between gap-1 border-b py-2 text-sm sm:flex-row"
							>
								<span>
									{event.actor?.name ?? "System"} · {event.action} ·{" "}
									{event.outcome}
								</span>
								<span className="text-muted-foreground">
									{new Date(event.createdAt).toLocaleString()}
								</span>
							</div>
						))
					) : (
						<p className="text-sm text-muted-foreground">
							No outreach audit events yet.
						</p>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function Step({
	number,
	title,
	description,
	children,
}: {
	number: string;
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<Badge variant="outline">{number}</Badge>
					<CardTitle>{title}</CardTitle>
				</div>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-3">{children}</CardContent>
		</Card>
	);
}

function Readiness({
	label,
	value,
	detail,
}: {
	label: string;
	value: string;
	detail: string;
}) {
	return (
		<div className="rounded-md border p-3">
			<div className="flex items-center justify-between gap-2">
				<p className="font-medium">{label}</p>
				<Badge variant="outline">{value}</Badge>
			</div>
			<p className="mt-1 text-xs text-muted-foreground">{detail}</p>
		</div>
	);
}

function State({
	children,
	tone,
}: {
	children: React.ReactNode;
	tone: "neutral" | "warning" | "danger";
}) {
	const color =
		tone === "danger"
			? "border-destructive/40 text-destructive"
			: tone === "warning"
				? "border-amber-500/40 text-amber-700 dark:text-amber-300"
				: "text-muted-foreground";
	return <p className={`rounded-md border p-3 text-sm ${color}`}>{children}</p>;
}

function Select({
	label,
	value,
	onChange,
	options,
	optional = false,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	options: { value: string; label: string }[];
	optional?: boolean;
}) {
	return (
		<label className="grid gap-1 text-sm font-medium">
			{label}
			<select
				aria-label={label}
				className={selectClass}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			>
				<option value="">
					{optional
						? `New ${label.toLowerCase()}`
						: `Select ${label.toLowerCase()}`}
				</option>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
}
