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
import Link from "next/link";
import { Children, type ReactNode } from "react";
import { LocalRelativeTime } from "@/components/local-date-time";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

type Workspace = RouterOutputs["operations"]["outreachWorkspace"];

const attentionLabels: Record<string, string> = {
	NEEDS_IHSAN: "Needs Ihsan",
	WITH_IHSAN: "With Ihsan",
	PARKED: "Parked",
	SUPPRESSED: "Suppressed",
	NONE: "Active",
};

export function AtlasOperationsSummary({
	mode = "command",
}: {
	mode?: "command" | "outreach";
}) {
	const trpc = useTRPC();
	const workspaceUrl = useWorkspaceUrl();
	const query = useQuery(trpc.operations.outreachWorkspace.queryOptions());

	if (!query.data) return null;
	if (mode === "command") {
		return (
			<CommandAtlasSummary data={query.data} workspaceUrl={workspaceUrl} />
		);
	}
	return (
		<AtlasOperationsSummaryContent
			data={query.data}
			mode={mode}
			workspaceUrl={workspaceUrl}
		/>
	);
}

function CommandAtlasSummary({
	data,
	workspaceUrl,
}: {
	data: Workspace;
	workspaceUrl: (path: string) => string;
}) {
	const needsIhsan = data.leads.filter(
		(lead) => lead.attentionState === "NEEDS_IHSAN",
	);
	const warm = data.leads
		.filter((lead) => ["WARM", "MEETING", "OPPORTUNITY"].includes(lead.stage))
		.slice(0, 5);
	const followUps = data.leads
		.filter((lead) => lead.nextActionAt)
		.sort(
			(a, b) =>
				new Date(a.nextActionAt ?? 0).getTime() -
				new Date(b.nextActionAt ?? 0).getTime(),
		)
		.slice(0, 5);
	const stageCounts = data.dailyReport.leadStageCounts;

	return (
		<div className="grid gap-4">
			<Card>
				<CardHeader
					className={
						needsIhsan.length ? "border-destructive border-l-4 pl-4" : undefined
					}
				>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="grid gap-1">
							<CardTitle>NEEDS_IHSAN</CardTitle>
							<CardDescription>
								The decisions and serious handoffs Atlas has paused for you.
							</CardDescription>
						</div>
						<Badge variant={needsIhsan.length ? "destructive" : "outline"}>
							{needsIhsan.length} waiting
						</Badge>
					</div>
				</CardHeader>
				<CardContent>
					{needsIhsan.length ? (
						<div className="grid gap-2">
							{needsIhsan.slice(0, 4).map((lead) => (
								<div
									key={lead.id}
									className="grid gap-1 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
								>
									<div className="min-w-0">
										<p className="truncate font-medium text-sm">{lead.name}</p>
										<p className="truncate text-muted-foreground text-xs">
											{lead.company?.name ?? "No company linked"} · {lead.stage}
										</p>
										<p className="mt-1 line-clamp-2 text-sm">
											{lead.handoffRecommendedAction ??
												lead.handoffSummary ??
												"Review the handoff and choose the next action."}
										</p>
									</div>
									{lead.handoffAt ? (
										<LocalRelativeTime date={lead.handoffAt} />
									) : null}
								</div>
							))}
							{needsIhsan.length > 4 ? (
								<Link
									href={workspaceUrl("/outreach")}
									className="text-sm underline underline-offset-4 hover:no-underline"
								>
									View all {needsIhsan.length} items in Outreach
								</Link>
							) : null}
						</div>
					) : (
						<p className="text-muted-foreground text-sm">
							Nothing needs your decision right now.
						</p>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="grid gap-1">
							<CardTitle>Atlas today</CardTitle>
							<CardDescription>
								Status, safety gates and persisted activity for this operating
								day.
							</CardDescription>
						</div>
						<Badge variant="outline">
							{data.readiness.agent === "READY" ? "ACTIVE" : "PAUSED"}
						</Badge>
					</div>
				</CardHeader>
				<CardContent className="grid gap-4">
					<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
						<StatusRow label="Bridge" value={data.readiness.agent} />
						<StatusRow label="Mailbox" value={data.readiness.mailbox} />
						<StatusRow label="Delivery" value={data.readiness.delivery} />
						<StatusRow
							label="Live outreach"
							value="DISABLED"
							detail="Human approval required"
						/>
					</div>
					<div className="grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-3 lg:grid-cols-6">
						<Metric label="Emails sent" value={data.dailyReport.outreachSent} />
						<Metric label="Replies" value={data.dailyReport.outreachReplies} />
						<Metric label="Meetings" value={data.dailyReport.meetings} />
						<Metric label="New leads" value={stageCounts.NEW ?? 0} />
						<Metric label="Warm" value={stageCounts.WARM ?? 0} />
						<Metric label="Blocked" value={needsIhsan.length} />
					</div>
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs">
						<span className="text-muted-foreground">
							Cold quota:{" "}
							{data.dailyReport.quota
								? `${data.dailyReport.quota.coldEmailSent}/${data.dailyReport.quota.coldEmailLimit}`
								: "not set"}
						</span>
						{data.atlasDailyReport ? (
							<span className="text-muted-foreground">
								Last report: {data.atlasDailyReport.summary}
							</span>
						) : null}
						<Link
							href={workspaceUrl("/outreach")}
							className="underline underline-offset-4 hover:no-underline"
						>
							Open Atlas activity
						</Link>
					</div>
				</CardContent>
			</Card>

			{followUps.length || warm.length ? (
				<div className="grid gap-4 @3xl/page-content:grid-cols-2">
					{followUps.length ? (
						<QueueCard
							title="Upcoming follow-ups"
							description="The next actions already recorded."
							empty="No follow-ups are scheduled."
						>
							{followUps.map((lead) => (
								<QueueRow
									key={lead.id}
									title={lead.name}
									detail={lead.nextActionTitle ?? "Next action not described"}
									meta={
										lead.nextActionAt ? (
											<LocalRelativeTime date={lead.nextActionAt} />
										) : null
									}
								/>
							))}
						</QueueCard>
					) : null}
					{warm.length ? (
						<QueueCard
							title="Warm opportunities"
							description="The conversations closest to a human decision."
							empty="No warm opportunities yet."
						>
							{warm.map((lead) => (
								<QueueRow
									key={lead.id}
									title={lead.name}
									detail={lead.nextActionTitle ?? "No next action recorded"}
									meta={attentionLabels[lead.attentionState] ?? lead.stage}
								/>
							))}
						</QueueCard>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function AtlasOperationsSummaryContent({
	data,
	mode,
	workspaceUrl,
}: {
	data: Workspace;
	mode: "command" | "outreach";
	workspaceUrl: (path: string) => string;
}) {
	const needsIhsan = data.leads.filter(
		(lead) => lead.attentionState === "NEEDS_IHSAN",
	);
	const warm = data.leads.filter((lead) =>
		["WARM", "MEETING", "OPPORTUNITY"].includes(lead.stage),
	);
	const followUps = data.leads
		.filter((lead) => lead.nextActionAt)
		.sort(
			(a, b) =>
				new Date(a.nextActionAt ?? 0).getTime() -
				new Date(b.nextActionAt ?? 0).getTime(),
		)
		.slice(0, 5);
	const conversations = data.threads.slice(0, 5);
	const stageCounts = data.dailyReport.leadStageCounts;

	return (
		<div className="grid gap-6">
			<Card>
				<CardHeader
					className={
						needsIhsan.length ? "border-destructive border-l-4 pl-4" : undefined
					}
				>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="grid gap-1">
							<CardTitle>NEEDS_IHSAN</CardTitle>
							<CardDescription>
								Human decisions, serious handoffs and meeting approvals that
								Atlas will not take on its own.
							</CardDescription>
						</div>
						<Badge variant={needsIhsan.length ? "destructive" : "outline"}>
							{needsIhsan.length} waiting
						</Badge>
					</div>
				</CardHeader>
				<CardContent>
					{needsIhsan.length ? (
						<div className="grid gap-2">
							{needsIhsan.map((lead) => (
								<div
									key={lead.id}
									className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
								>
									<div className="min-w-0">
										<p className="truncate font-medium text-sm">{lead.name}</p>
										<p className="text-muted-foreground text-xs">
											{lead.contact
												? [lead.contact.firstName, lead.contact.lastName]
														.filter(Boolean)
														.join(" ")
												: "No linked contact"}{" "}
											· {lead.company?.name ?? "No company linked"} ·{" "}
											{attentionLabels[lead.attentionState] ??
												lead.attentionState}
										</p>
										<p className="mt-1 text-sm">
											{lead.handoffSummary ??
												lead.handoffReason ??
												"Atlas paused this lead for human review."}
										</p>
										<p className="mt-1 text-muted-foreground text-xs">
											Next:{" "}
											{lead.handoffRecommendedAction ??
												lead.nextActionTitle ??
												"Review the handoff and choose the next action."}
										</p>
									</div>
									<span className="text-muted-foreground text-xs">
										{(lead.handoffAt ?? lead.nextActionAt) ? (
											<LocalRelativeTime
												date={(lead.handoffAt ?? lead.nextActionAt) as string}
											/>
										) : (
											"No time set"
										)}
									</span>
								</div>
							))}
						</div>
					) : (
						<p className="text-muted-foreground text-sm">
							No handoffs are waiting. Atlas is clear to continue within its
							approved rules.
						</p>
					)}
				</CardContent>
			</Card>

			<div className="grid gap-4 @3xl/page-content:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Atlas status</CardTitle>
						<CardDescription>
							Readiness and safety gates for the current operating session.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3 sm:grid-cols-2">
						<StatusRow
							label="Atlas mode"
							value={data.readiness.agent === "READY" ? "ACTIVE" : "PAUSED"}
							detail="Restricted system operator"
						/>
						<StatusRow label="Atlas bridge" value={data.readiness.agent} />
						<StatusRow
							label="Verified mailbox"
							value={data.readiness.mailbox}
						/>
						<StatusRow
							label="Provider delivery"
							value={data.readiness.delivery}
						/>
						<StatusRow
							label="Live outreach"
							value="DISABLED"
							detail="Human approval remains required"
						/>
						<StatusRow
							label="Cold quota"
							value={
								data.dailyReport.quota
									? String(data.dailyReport.quota.coldEmailSent) +
										"/" +
										String(data.dailyReport.quota.coldEmailLimit)
									: "NOT SET"
							}
							detail="Sent against the daily ceiling"
						/>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Today’s Atlas pulse</CardTitle>
						<CardDescription>
							Counts come from persisted outreach, reply, meeting and lead
							records.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
						<Metric label="Emails sent" value={data.dailyReport.outreachSent} />
						<Metric label="Replies" value={data.dailyReport.outreachReplies} />
						<Metric label="Meetings" value={data.dailyReport.meetings} />
						<Metric label="New leads" value={stageCounts.NEW ?? 0} />
						<Metric label="Qualified" value={stageCounts.QUALIFIED ?? 0} />
						<Metric label="Warm" value={stageCounts.WARM ?? 0} />
						<Metric label="Active workload" value={data.leads.length} />
						<Metric label="Blocked" value={needsIhsan.length} />
					</CardContent>
				</Card>
			</div>

			<div className="grid gap-4 @3xl/page-content:grid-cols-3">
				<QueueCard
					title="Upcoming follow-ups"
					description="The next actions Atlas has recorded."
					empty="No follow-ups are scheduled."
				>
					{followUps.map((lead) => (
						<QueueRow
							key={lead.id}
							title={lead.name}
							detail={lead.nextActionTitle ?? "Next action not described"}
							meta={
								lead.nextActionAt ? (
									<LocalRelativeTime date={lead.nextActionAt} />
								) : null
							}
						/>
					))}
				</QueueCard>
				<QueueCard
					title="Warm opportunities"
					description="Conversations close to a human decision."
					empty="No warm opportunities yet."
				>
					{warm.slice(0, 5).map((lead) => (
						<QueueRow
							key={lead.id}
							title={lead.name}
							detail={lead.nextActionTitle ?? "No next action recorded"}
							meta={attentionLabels[lead.attentionState] ?? lead.stage}
						/>
					))}
				</QueueCard>
				<QueueCard
					title="Active conversations"
					description="Recent mailbox-scoped threads."
					empty="No conversations have been recorded."
				>
					{conversations.map((thread) => (
						<QueueRow
							key={thread.id}
							title={thread.subject ?? "Untitled conversation"}
							detail={
								String(thread.messageCount) +
								" message" +
								(thread.messageCount === 1 ? "" : "s")
							}
							meta={<LocalRelativeTime date={thread.lastMessageAt} />}
						/>
					))}
				</QueueCard>
			</div>

			<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
				<Link
					className="underline underline-offset-4 hover:no-underline"
					href={workspaceUrl("/outreach")}
				>
					Open outreach monitor
				</Link>
				{mode === "command" ? (
					<Link
						className="text-muted-foreground underline underline-offset-4 hover:no-underline"
						href={workspaceUrl("/settings/connections")}
					>
						Review provider connections
					</Link>
				) : null}
			</div>
			{data.atlasDailyReport ? (
				<p className="text-muted-foreground text-xs">
					Last Atlas report: {data.atlasDailyReport.summary}
				</p>
			) : null}
		</div>
	);
}

function StatusRow({
	label,
	value,
	detail,
}: {
	label: string;
	value: string;
	detail?: string;
}) {
	return (
		<div className="flex min-w-0 items-start justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0">
			<div className="min-w-0">
				<p className="text-muted-foreground text-xs">{label}</p>
				{detail ? <p className="mt-1 text-xs">{detail}</p> : null}
			</div>
			<Badge
				variant={
					value === "READY" || value === "DISABLED" ? "outline" : "secondary"
				}
			>
				{value}
			</Badge>
		</div>
	);
}

function Metric({ label, value }: { label: string; value: number }) {
	return (
		<div className="grid gap-1">
			<span className="text-muted-foreground text-xs">{label}</span>
			<strong className="text-lg tabular-nums">{value}</strong>
		</div>
	);
}

function QueueCard({
	title,
	description,
	empty,
	children,
}: {
	title: string;
	description: string;
	empty: string;
	children: ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-2">
				{Children.count(children) > 0 ? (
					children
				) : (
					<p className="text-muted-foreground text-sm">{empty}</p>
				)}
			</CardContent>
		</Card>
	);
}

function QueueRow({
	title,
	detail,
	meta,
}: {
	title: string;
	detail: string;
	meta: ReactNode;
}) {
	return (
		<div className="grid min-w-0 gap-1 border-b pb-2 last:border-b-0 last:pb-0">
			<div className="flex min-w-0 items-baseline justify-between gap-2">
				<p className="truncate font-medium text-sm">{title}</p>
				{meta ? (
					<span className="shrink-0 text-muted-foreground text-xs">{meta}</span>
				) : null}
			</div>
			<p className="truncate text-muted-foreground text-xs">{detail}</p>
		</div>
	);
}
