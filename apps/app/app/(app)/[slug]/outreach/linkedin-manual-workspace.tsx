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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

type ManualMessage = { id: string; direction: string; body: string };
type ManualAction = {
	id: string;
	profileUrl: string;
	type: "REPLY" | "WARM_FOLLOW_UP" | "CONNECTION_REQUEST" | "FIRST_MESSAGE";
	whyNow: string;
	body: string | null;
	contact: {
		firstName: string;
		lastName: string | null;
		company: { name: string } | null;
	};
	route: { value: string } | null;
	conversation: { messages: ManualMessage[] } | null;
};
type ManualHandoff = {
	id: string;
	classification: string;
	contact: { firstName: string; lastName: string | null };
	messages: ManualMessage[];
};
type ManualList = { actions: ManualAction[]; handoffs: ManualHandoff[] };

const typeOrder = {
	REPLY: 0,
	WARM_FOLLOW_UP: 1,
	CONNECTION_REQUEST: 2,
	FIRST_MESSAGE: 3,
} as const;

function fullName(contact: { firstName: string; lastName: string | null }) {
	return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

export function LinkedInManualWorkspace() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const query = useQuery(trpc.linkedinManual.list.queryOptions({ limit: 20 }));
	const data = query.data as unknown as ManualList | undefined;
	const refresh = async () =>
		queryClient.invalidateQueries({
			queryKey: trpc.linkedinManual.list.queryKey({ limit: 20 }),
		});
	const failed = (error: { message: string }) => toast.error(error.message);
	const complete = useMutation(
		trpc.linkedinManual.complete.mutationOptions({
			onSuccess: async () => {
				toast.success("Manual LinkedIn action recorded in CRM.");
				await refresh();
			},
			onError: failed,
		}),
	);
	const cancel = useMutation(
		trpc.linkedinManual.cancel.mutationOptions({
			onSuccess: async () => {
				toast.success("Prepared action cancelled.");
				await refresh();
			},
			onError: failed,
		}),
	);
	const actions = [...(data?.actions ?? [])].sort(
		(a, b) => typeOrder[a.type] - typeOrder[b.type],
	);
	const handoffs = data?.handoffs ?? [];

	return (
		<section className="grid gap-5" aria-labelledby="linkedin-manual-title">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 id="linkedin-manual-title" className="text-xl font-semibold">
						LinkedIn manual action batch
					</h2>
					<p className="text-muted-foreground text-sm">
						Atlas prepares and records actions. Open LinkedIn and perform each
						action yourself. Nothing here sends or opens an executor job.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Badge variant="secondary">Manual mode</Badge>
					<Button
						type="button"
						variant="outline"
						onClick={() => void query.refetch()}
						disabled={query.isFetching}
					>
						Refresh
					</Button>
				</div>
			</div>

			{query.isError ? (
				<p role="alert" className="text-destructive text-sm">
					Could not load the manual LinkedIn workspace: {query.error.message}
				</p>
			) : null}

			<div className="grid gap-4">
				{actions.length === 0 ? (
					<Card>
						<CardContent className="pt-6 text-muted-foreground text-sm">
							There are no prepared LinkedIn actions right now. Refresh after a
							read-only reconciliation or when Atlas has prepared the next
							batch.
						</CardContent>
					</Card>
				) : null}
				{actions.map((action, index) => {
					const contact = action.contact;
					const company = contact.company?.name;
					const messages = action.conversation?.messages
						? [...action.conversation.messages].reverse()
						: [];
					return (
						<Card key={action.id}>
							<CardHeader>
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div className="space-y-1">
										<CardTitle>
											{index + 1}. {fullName(contact)}
										</CardTitle>
										<CardDescription>
											{company ? `${company} · ` : ""}
											{action.type.replaceAll("_", " ")}
										</CardDescription>
									</div>
									<Badge variant="outline">Prepared</Badge>
								</div>
								<p className="text-sm">{action.whyNow}</p>
								{(action.route?.value ?? action.profileUrl) ? (
									<a
										className="break-all text-primary text-sm underline underline-offset-4"
										href={action.route?.value ?? action.profileUrl}
										target="_blank"
										rel="noreferrer"
									>
										{action.route?.value ?? action.profileUrl}
									</a>
								) : null}
							</CardHeader>
							<CardContent className="grid gap-4">
								{messages.length ? (
									<div className="grid gap-2 rounded-md border p-3">
										<p className="font-medium text-sm">Recent conversation</p>
										{messages.map((message) => (
											<p
												className="text-muted-foreground text-sm"
												key={message.id}
											>
												<span className="font-medium text-foreground">
													{message.direction === "INBOUND" ? "Them" : "Ihsan"}:
												</span>{" "}
												{message.body}
											</p>
										))}
									</div>
								) : null}
								{action.body ? (
									<div className="grid gap-2">
										<p className="font-medium text-sm">Exact text to paste</p>
										<pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-sm">
											{action.body}
										</pre>
										<Button
											type="button"
											variant="outline"
											onClick={() => {
												void navigator.clipboard
													.writeText(action.body ?? "")
													.then(() => toast.success("Copy prepared."))
													.catch(() =>
														toast.error("Clipboard is unavailable."),
													);
											}}
										>
											Copy text
										</Button>
									</div>
								) : action.type === "CONNECTION_REQUEST" ? (
									<p className="text-sm">Send the request without a note.</p>
								) : null}
								<div className="flex flex-wrap gap-2">
									<Button
										type="button"
										disabled={
											complete.isPending ||
											(action.type !== "CONNECTION_REQUEST" && !action.body)
										}
										onClick={() => {
											if (
												!window.confirm(
													"Confirm you already performed this exact action manually in LinkedIn. Atlas will only record your confirmation and will not send or verify it.",
												)
											)
												return;
											complete.mutate({ id: action.id });
										}}
									>
										I sent this manually
									</Button>
									<Button
										type="button"
										variant="outline"
										disabled={cancel.isPending}
										onClick={() => cancel.mutate({ id: action.id })}
									>
										Cancel prepared action
									</Button>
								</div>
							</CardContent>
						</Card>
					);
				})}
			</div>

			{handoffs.length ? (
				<Card>
					<CardHeader>
						<CardTitle>Ihsan review</CardTitle>
						<CardDescription>
							These conversations are surfaced for human judgment and are not
							included as routine prepared replies.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4">
						{handoffs.map((handoff) => (
							<div
								className="grid gap-2 border-t pt-4 first:border-0 first:pt-0"
								key={handoff.id}
							>
								<p className="font-medium text-sm">
									{fullName(handoff.contact)} ·{" "}
									{handoff.classification.replaceAll("_", " ")}
								</p>
								{[...handoff.messages].reverse().map((message) => (
									<p className="text-muted-foreground text-sm" key={message.id}>
										<span className="font-medium text-foreground">
											{message.direction === "INBOUND" ? "Them" : "Ihsan"}:
										</span>{" "}
										{message.body}
									</p>
								))}
							</div>
						))}
					</CardContent>
				</Card>
			) : null}
		</section>
	);
}
