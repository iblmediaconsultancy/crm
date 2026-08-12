"use client";

import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

type Option = { id: string; label: string };

export function OutreachLifecycleControls() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const selectors = useQuery(
		trpc.operations.selectors.queryOptions({ q: "", take: 100, skip: 0 }),
	);
	const plans = useQuery(trpc.outreachLifecycle.listPlans.queryOptions());
	const [routeId, setRouteId] = useState("");
	const [reason, setReason] = useState("");
	const [draftId, setDraftId] = useState("");
	const [dueAt, setDueAt] = useState("");
	const [cancelReason, setCancelReason] = useState("");
	const refresh = () => queryClient.invalidateQueries();
	const consent = useMutation(
		trpc.outreachLifecycle.setConsent.mutationOptions({
			onSuccess: async () => {
				toast.success("Route consent updated and future steps reconciled.");
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const follow = useMutation(
		trpc.outreachLifecycle.createFollowUpPlan.mutationOptions({
			onSuccess: async () => {
				toast.success("Follow-up scheduled in PostgreSQL.");
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const cancel = useMutation(
		trpc.outreachLifecycle.cancelFollowUpPlan.mutationOptions({
			onSuccess: async () => {
				toast.success("Follow-up and queued delivery work cancelled.");
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const route = selectors.data?.routes.find((item) => item.id === routeId);
	const approved = (selectors.data?.drafts ?? []).filter(
		(draft) => draft.status === "APPROVED",
	);

	return (
		<div className="grid gap-4 xl:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle>Consent and DNC</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-3">
					<Choice
						value={routeId}
						onValueChange={setRouteId}
						placeholder="Choose an owned or shared route"
						options={(selectors.data?.routes ?? []).map((item) => ({
							id: item.id,
							label: [
								item.contact
									? [item.contact.firstName, item.contact.lastName]
											.filter(Boolean)
											.join(" ")
									: item.company?.name,
								item.label ?? item.value,
							]
								.filter(Boolean)
								.join(" · "),
						}))}
					/>
					<Input
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						placeholder="Required reason and source context"
					/>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="destructive"
							disabled={!routeId || reason.trim().length < 3}
							onClick={() =>
								consent.mutate({
									routeId,
									status: "DO_NOT_CONTACT",
									reason,
									source: "CRM_USER",
								})
							}
						>
							Set do not contact
						</Button>
						<Button
							variant="outline"
							disabled={!routeId || reason.trim().length < 3}
							onClick={() =>
								consent.mutate({
									routeId,
									status: "ALLOWED",
									reason,
									source: "AUDITED_RECONSENT",
								})
							}
						>
							Record re-consent
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">
						DNC immediately cancels pending steps, queued drafts, and unsent
						delivery work. Re-consent never restarts a cancelled sequence.
					</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Schedule approved follow-up</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-3">
					<Choice
						value={draftId}
						onValueChange={setDraftId}
						placeholder="Choose an independently approved draft"
						options={approved
							.filter((draft) => !routeId || draft.recipientRouteId === routeId)
							.map((draft) => ({
								id: draft.id,
								label: `${draft.subject ?? "Untitled"} · ${draft.status}`,
							}))}
					/>
					<Input
						type="datetime-local"
						value={dueAt}
						onChange={(event) => setDueAt(event.target.value)}
					/>
					<Button
						disabled={!route?.contact?.id || !draftId || !dueAt}
						onClick={() =>
							follow.mutate({
								contactId: route!.contact!.id,
								routeId,
								steps: [{ draftId, dueAt: new Date(dueAt) }],
							})
						}
					>
						Schedule follow-up
					</Button>
					<p className="text-xs text-muted-foreground">
						Due steps are leased, retried, and recovered exclusively through
						PostgreSQL.
					</p>
				</CardContent>
			</Card>

			<Card className="xl:col-span-2">
				<CardHeader>
					<CardTitle>Follow-up lifecycle</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-3">
					<Input
						value={cancelReason}
						onChange={(event) => setCancelReason(event.target.value)}
						placeholder="Reason required when cancelling a plan"
					/>
					{!plans.data?.length ? (
						<p className="text-sm text-muted-foreground">
							No follow-up plans are visible to you.
						</p>
					) : (
						plans.data.map((plan) => (
							<div
								key={plan.id}
								className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
							>
								<div>
									<div className="flex flex-wrap items-center gap-2">
										<p className="font-medium">{plan.contactLabel}</p>
										<Badge variant="outline">{plan.status}</Badge>
									</div>
									<p className="text-sm text-muted-foreground">
										{plan.routeLabel} · {plan.ownerName} · {plan.pendingSteps}/
										{plan.totalSteps} pending
									</p>
									<p className="text-xs text-muted-foreground">
										{plan.nextDueAt
											? `Next due ${new Date(plan.nextDueAt).toLocaleString()}`
											: (plan.cancellationReason ?? "No future step")}
									</p>
								</div>
								{plan.status === "ACTIVE" || plan.status === "PAUSED" ? (
									<Button
										variant="outline"
										disabled={cancelReason.trim().length < 3}
										onClick={() =>
											cancel.mutate({ planId: plan.id, reason: cancelReason })
										}
									>
										Cancel plan
									</Button>
								) : null}
							</div>
						))
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function Choice({
	value,
	onValueChange,
	options,
	placeholder,
}: {
	value: string;
	onValueChange: (value: string) => void;
	options: Option[];
	placeholder: string;
}) {
	return (
		<Select value={value || undefined} onValueChange={onValueChange}>
			<SelectTrigger>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.id} value={option.id}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
