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
import { useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

function formatAmsterdam(value: string | Date | null) {
	if (!value) return "Not available";
	return new Date(value).toLocaleString("en-GB", {
		timeZone: "Europe/Amsterdam",
		dateStyle: "medium",
		timeStyle: "short",
	});
}

export function FollowUpExecutionCohorts() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
	const preview = useQuery({
		...trpc.outreachLifecycle.previewFollowUpCohort.queryOptions(),
		refetchOnWindowFocus: false,
	});
	const cohorts = useQuery(
		trpc.outreachLifecycle.listFollowUpExecutionCohorts.queryOptions(),
	);
	const readiness = useQuery({
		...trpc.outreachLifecycle.atlasSystemReadiness.queryOptions(),
		refetchInterval: 30_000,
	});
	const prepare = useMutation(
		trpc.outreachLifecycle.prepareFollowUpExecutionCohort.mutationOptions({
			onSuccess: async (result) => {
				toast.success(
					`Prepared cohort ${result.id} with ${result.selectedCount} steps.`,
				);
				setSelectedIds(null);
				await queryClient.invalidateQueries();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const eligible =
		preview.data?.candidates.filter((candidate) => candidate.eligible) ?? [];
	const chosenIds = selectedIds ?? eligible.map((candidate) => candidate.id);
	const excluded =
		preview.data?.candidates.filter((candidate) => !candidate.eligible) ?? [];

	return (
		<Card>
			<CardHeader>
				<CardTitle>Exact-ID follow-up cohorts</CardTitle>
				<CardDescription>
					Freshly preflight due steps, persist an immutable allowlist, then bind
					a standard authorization to that cohort. Membership is not a send
					approval; the worker rechecks live policy and canonical timing before
					queueing.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-5">
				<section
					aria-labelledby="follow-up-cohort-runtime"
					className="grid gap-2"
				>
					<h3 id="follow-up-cohort-runtime" className="font-medium text-sm">
						Execution gates
					</h3>
					{readiness.data ? (
						<div className="grid gap-2 text-sm sm:grid-cols-2">
							<p>Authorization: {readiness.data.authorization.status}</p>
							<p>Live outreach: {readiness.data.liveOutreach}</p>
							<p>PostgreSQL worker: {readiness.data.postgresWorker}</p>
							<p>Provider: {readiness.data.provider}</p>
							<p>Dispatch readiness: {readiness.data.status}</p>
						</div>
					) : (
						<p className="text-sm text-muted-foreground" role="status">
							Checking current execution gates.
						</p>
					)}
					<p className="text-xs text-muted-foreground">
						Scheduled execution must also be deliberately enabled for the worker
						to claim an authorized cohort.
					</p>
				</section>

				<section
					aria-labelledby="follow-up-cohort-preview"
					className="grid gap-3"
				>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="grid gap-1">
							<h3 id="follow-up-cohort-preview" className="font-medium text-sm">
								Current due-step preflight
							</h3>
							<p className="text-xs text-muted-foreground">
								{preview.data
									? `As of ${formatAmsterdam(preview.data.asOf)} · ${preview.data.candidateCount} candidates evaluated · ${eligible.length} eligible · ${excluded.length} excluded`
									: "Review current persisted due steps before preparing a cohort."}
							</p>
						</div>
						<Button
							variant="outline"
							disabled={preview.isFetching}
							onClick={() => void preview.refetch()}
						>
							{preview.isFetching ? "Refreshing…" : "Refresh preflight"}
						</Button>
					</div>
					{preview.isError ? (
						<p className="text-sm text-destructive" role="alert">
							Preflight failed. No cohort can be prepared until it succeeds.{" "}
							{preview.error.message}
						</p>
					) : null}
					{preview.data?.eligibleCount ? (
						<p className="text-xs text-muted-foreground">
							Eligible canonical due window:{" "}
							{formatAmsterdam(preview.data.earliestEligibleDueAt)} to{" "}
							{formatAmsterdam(preview.data.latestEligibleDueAt)}
						</p>
					) : null}
					{preview.data && Object.keys(preview.data.excludedByReason).length ? (
						<details className="grid gap-2 rounded-md border p-3">
							<summary className="cursor-pointer font-medium text-sm">
								Exclusion counts by reason
							</summary>
							<ul className="grid gap-1 pl-5 text-xs text-muted-foreground">
								{Object.entries(preview.data.excludedByReason)
									.sort(([left], [right]) => left.localeCompare(right))
									.map(([reason, count]) => (
										<li key={reason}>
											{reason}: {count}
										</li>
									))}
							</ul>
						</details>
					) : null}
					{preview.data?.truncatedAt ? (
						<p className="text-sm text-destructive" role="alert">
							The preview reached the 500-step limit. Prepare smaller cohorts
							from the displayed selection before reviewing further due steps.
						</p>
					) : null}
					{eligible.length ? (
						<fieldset className="grid gap-2">
							<legend className="text-xs text-muted-foreground">
								Select exact step IDs to include. All preflight-passing steps
								are selected initially.
							</legend>
							<div className="grid max-h-72 gap-2 overflow-y-auto rounded-lg border p-3">
								{eligible.map((candidate) => (
									<label
										key={candidate.id}
										className="flex items-start gap-2 text-sm"
									>
										<input
											type="checkbox"
											checked={chosenIds.includes(candidate.id)}
											onChange={(event) => {
												const current = new Set(chosenIds);
												if (event.target.checked) current.add(candidate.id);
												else current.delete(candidate.id);
												setSelectedIds([...current]);
											}}
										/>
										<span className="grid gap-1">
											<span>
												{candidate.contactName || candidate.contactId} ·{" "}
												{candidate.companyName || "Organization unresolved"}
											</span>
											<span className="text-xs text-muted-foreground">
												{candidate.id} · FU{candidate.position + 1} ·{" "}
												{candidate.route ?? "No route"} · canonical due{" "}
												{formatAmsterdam(candidate.canonicalDueAt)}
											</span>
										</span>
									</label>
								))}
							</div>
						</fieldset>
					) : (
						<p className="text-sm text-muted-foreground" role="status">
							{preview.data?.candidateCount === 0
								? "No follow-up steps are currently due for preflight."
								: "No currently due follow-up steps pass cohort preflight."}
						</p>
					)}
					{excluded.length ? (
						<details className="grid gap-2 rounded-md border p-3">
							<summary className="cursor-pointer font-medium text-sm">
								Excluded steps and reasons ({excluded.length})
							</summary>
							<ul className="grid gap-1 pl-5 text-xs text-muted-foreground">
								{excluded.map((candidate) => (
									<li key={candidate.id}>
										{candidate.id}: {candidate.reason}
									</li>
								))}
							</ul>
						</details>
					) : null}
					<div className="flex flex-wrap items-center gap-2">
						<Button
							disabled={!chosenIds.length || prepare.isPending || !preview.data}
							onClick={() => prepare.mutate({ stepIds: chosenIds })}
						>
							{prepare.isPending
								? "Preparing cohort…"
								: `Prepare exact cohort (${chosenIds.length})`}
						</Button>
						<p className="text-xs text-muted-foreground">
							Preparation creates no authorization or outbound delivery.
						</p>
					</div>
				</section>

				<section
					aria-labelledby="follow-up-cohort-history"
					className="grid gap-3"
				>
					<h3 id="follow-up-cohort-history" className="font-medium text-sm">
						Persisted cohort history
					</h3>
					{cohorts.data?.length ? (
						<div className="grid gap-3">
							{cohorts.data.map((cohort) => {
								const dueTimes = cohort.members.map((member) =>
									new Date(member.canonicalDueAt).getTime(),
								);
								const excludedRows = cohort.excludedAtPreparation;
								const pending = cohort.members.filter(
									(member) => member.status === "PENDING",
								).length;
								const queued = cohort.members.filter(
									(member) => member.status === "QUEUED",
								).length;
								const blocked = cohort.members.filter(
									(member) => member.status === "BLOCKED",
								).length;
								return (
									<div
										key={cohort.id}
										className="grid gap-2 rounded-lg border p-3"
									>
										<div className="flex flex-wrap items-center gap-2">
											<Badge variant="secondary">{cohort.state}</Badge>
											<code className="text-xs">{cohort.id}</code>
										</div>
										<p className="text-xs text-muted-foreground">
											{cohort.members.length} exact IDs · {pending} pending ·{" "}
											{queued} queued · {blocked} blocked ·{" "}
											{excludedRows.length} excluded at preparation
										</p>
										<p className="text-xs text-muted-foreground">
											Canonical due window:{" "}
											{dueTimes.length
												? formatAmsterdam(new Date(Math.min(...dueTimes)))
												: "none"}{" "}
											to{" "}
											{dueTimes.length
												? formatAmsterdam(new Date(Math.max(...dueTimes)))
												: "none"}
										</p>
										<p className="text-xs text-muted-foreground">
											Authorization:{" "}
											{cohort.authorization?.status ?? "NOT ISSUED"}
											{cohort.authorization
												? ` · expires ${formatAmsterdam(cohort.authorization.expiresAt)}`
												: ""}
										</p>
										{excludedRows.length ? (
											<details>
												<summary className="cursor-pointer text-xs font-medium">
													Preparation exclusions
												</summary>
												<ul className="grid gap-1 pl-5 pt-2 text-xs text-muted-foreground">
													{excludedRows.map((row) => (
														<li key={row.followUpStepId}>
															{row.followUpStepId}: {row.reason}
														</li>
													))}
												</ul>
											</details>
										) : null}
									</div>
								);
							})}
						</div>
					) : (
						<p className="text-sm text-muted-foreground" role="status">
							No follow-up cohorts have been prepared.
						</p>
					)}
				</section>
			</CardContent>
		</Card>
	);
}
