"use client";

import { Badge } from "@crm/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { StatGroup } from "@crm/ui/components/dashboard";
import { StatCard } from "@crm/ui/components/stat-card";
import {
	formatCount,
	formatMoneyCompact,
	formatPercent,
} from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryState } from "nuqs";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import { overviewParsers } from "./overview-search-params";

type CommandCenter = RouterOutputs["finance"]["commandCenter"];

function money(value: number | null, currency: string) {
	return value === null ? "Not available" : formatMoneyCompact(value, currency);
}

export function FinancialCommandCenter() {
	const trpc = useTRPC();
	const workspaceUrl = useWorkspaceUrl();
	const [scope] = useQueryState("scope", overviewParsers.scope);
	const searchParams = useSearchParams();
	const workspace = useQuery(trpc.workspace.get.queryOptions());
	const financeScope =
		workspace.data?.viewerRole === "admin" && !searchParams.has("scope")
			? "everyone"
			: scope;
	const query = useQuery({
		...trpc.finance.commandCenter.queryOptions({ scope: financeScope }),
		enabled: workspace.isSuccess,
		placeholderData: (previous) => previous,
	});

	if (!query.data) return null;
	return <CommandCenterContent data={query.data} workspaceUrl={workspaceUrl} />;
}

function CommandCenterContent({
	data,
	workspaceUrl,
}: {
	data: CommandCenter;
	workspaceUrl: (path: string) => string;
}) {
	const { financial, pipeline, goal, reportingCurrency, team } = data;
	const nextMilestone = goal?.milestones.find(
		(milestone) => new Date(milestone.date) > new Date(),
	);
	return (
		<div className="flex flex-col gap-6">
			<StatGroup>
				<StatCard
					label="Current MRR"
					value={money(financial.currentMrrCents, reportingCurrency)}
					description={
						financial.activeClients === null
							? "Financial data is restricted"
							: `${formatCount(financial.activeClients, "active client")}`
					}
				/>
				<StatCard
					label="Goal progress"
					value={
						goal
							? goal.progress === null
								? "Restricted"
								: formatPercent(goal.progress)
							: "No target"
					}
					description={
						goal
							? goal.currentCents === null
								? `Target ${money(goal.targetCents, reportingCurrency)} · progress restricted`
								: `${money(goal.currentCents, reportingCurrency)} of ${money(goal.targetCents, reportingCurrency)} · ${goal.status.replace("_", " ")}`
							: "Set an MRR target to measure pace"
					}
				/>
				<StatCard
					label="Weighted pipeline"
					value={money(pipeline.weightedMrrCents, reportingCurrency)}
					description={
						pipeline.openDeals === 0
							? "No open opportunities"
							: `${formatCount(pipeline.warmOpportunities, "warm opportunity")} · ${money(pipeline.forecastedMrrCents, reportingCurrency)} forecasted MRR`
					}
				/>
				<StatCard
					label="Estimated profit"
					value={money(financial.estimatedProfitCents, reportingCurrency)}
					description={
						financial.estimatedMargin === null
							? "Profit visibility is restricted"
							: `${formatPercent(financial.estimatedMargin)} estimated margin`
					}
				/>
			</StatGroup>

			<div className="grid gap-4 @3xl/page-content:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Revenue and financial health</CardTitle>
						<CardDescription>
							Current management view from active client relationships and
							expenses
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4 sm:grid-cols-2">
						<HealthItem
							label="Monthly revenue"
							value={money(financial.monthlyRevenueCents, reportingCurrency)}
						/>
						<HealthItem
							label="Direct client costs"
							value={money(financial.directClientCostsCents, reportingCurrency)}
						/>
						<HealthItem
							label="Operating costs"
							value={money(financial.operatingCostsCents, reportingCurrency)}
						/>
						<HealthItem
							label="Outstanding payments"
							value={money(financial.outstandingCents, reportingCurrency)}
						/>
						<HealthItem
							label="New MRR this month"
							value={money(financial.newMrrCents, reportingCurrency)}
						/>
						<HealthItem
							label="Lost MRR this month"
							value={money(financial.lostMrrCents, reportingCurrency)}
						/>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>{goal ? goal.name : "MRR goal"}</CardTitle>
						<CardDescription>
							{goal
								? `Deadline ${new Date(goal.deadline).toLocaleDateString()}`
								: "Company goals keep the team aligned"}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{goal ? (
							<>
								<div className="flex items-center justify-between gap-3 text-sm">
									<span>
										{money(goal.currentCents, reportingCurrency)} current
									</span>
									<Badge variant="outline">
										{goal.status.replace("_", " ")}
									</Badge>
								</div>
								{goal.progress !== null ? (
									<>
										<progress
											className="mt-4 h-2 w-full accent-primary"
											max={1}
											value={goal.progress}
											aria-label={`Progress toward ${goal.name}`}
										/>
										<div className="mt-2 flex flex-wrap justify-between gap-2 text-muted-foreground text-xs">
											<span>{formatPercent(goal.progress)} complete</span>
											<span>
												{money(goal.remainingCents, reportingCurrency)}{" "}
												remaining
											</span>
										</div>
										<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
											<span>
												Required pace:{" "}
												{money(goal.requiredPaceCents, reportingCurrency)} /
												month
											</span>
											{nextMilestone ? (
												<span>
													Next milestone:{" "}
													{money(
														nextMilestone.targetAmountCents,
														reportingCurrency,
													)}{" "}
													by {new Date(nextMilestone.date).toLocaleDateString()}
												</span>
											) : null}
										</div>
									</>
								) : (
									<p className="mt-4 text-muted-foreground text-sm">
										Progress is restricted by your financial permissions.
									</p>
								)}
							</>
						) : (
							<p className="text-muted-foreground text-sm">
								An Admin can add an MRR target from the goals settings.
							</p>
						)}
					</CardContent>
				</Card>
			</div>

			<div className="grid gap-4 @3xl/page-content:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Pipeline outlook</CardTitle>
						<CardDescription>
							{pipeline.openDeals} open opportunities ·{" "}
							{pipeline.totalOneOffCents === null
								? "Value restricted"
								: `${money(pipeline.totalOneOffCents, reportingCurrency)} one-off value`}
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3 sm:grid-cols-3">
						<HealthItem
							label="Potential MRR"
							value={money(pipeline.totalMrrCents, reportingCurrency)}
						/>
						<HealthItem
							label="Weighted MRR"
							value={money(pipeline.weightedMrrCents, reportingCurrency)}
						/>
						<HealthItem
							label="Forecasted MRR"
							value={money(pipeline.forecastedMrrCents, reportingCurrency)}
						/>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>
							{data.permissions.canTeam
								? "Team performance"
								: "Your weekly progress"}
						</CardTitle>
						<CardDescription>
							Work completed from CRM activity, tasks, proposals and closed
							relationships, with due work called out separately
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3">
						{team.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								No weekly targets have been assigned yet.
							</p>
						) : (
							team.map((row) => (
								<TeamRow
									key={row.user.id}
									row={row}
									currency={reportingCurrency}
								/>
							))
						)}
					</CardContent>
				</Card>
			</div>

			{financial.outstandingCents && financial.outstandingCents > 0 ? (
				<Link
					href={workspaceUrl("/operations")}
					className="text-sm underline underline-offset-4 hover:no-underline"
				>
					Review outstanding client payments
				</Link>
			) : null}
		</div>
	);
}

function HealthItem({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-1">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="font-medium text-lg tabular-nums">{value}</span>
		</div>
	);
}

function TeamRow({
	row,
	currency,
}: {
	row: CommandCenter["team"][number];
	currency: string;
}) {
	const target = row.target;
	const items: Array<[string, number, number | null | undefined]> = [
		["Outreach", row.actual.outreachContacts, target?.outreachContacts],
		["Follow-ups done", row.actual.followUps, target?.followUps],
		[
			"Qualified",
			row.actual.qualifiedOpportunities,
			target?.qualifiedOpportunities,
		],
		["Proposals", row.actual.proposals, target?.proposals],
		["Closed", row.actual.clientsClosed, target?.clientsClosed],
		["Positive responses", row.actual.positiveResponses, undefined],
		["Warm opportunities", row.actual.warmOpportunities, undefined],
		["Follow-ups due", row.actual.followUpsDue, undefined],
	];
	return (
		<div className="grid gap-2 rounded-lg border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="font-medium text-sm">{row.user.name}</span>
				<span className="text-muted-foreground text-xs">
					{money(row.actual.mrrGeneratedCents, currency)} MRR
					{target?.mrrGeneratedTargetCents !== null &&
					target?.mrrGeneratedTargetCents !== undefined
						? ` / ${money(target.mrrGeneratedTargetCents, currency)}`
						: ""}
				</span>
			</div>
			<div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
				{items.map(([label, actual, goal]) => (
					<span key={label} className="text-muted-foreground">
						{label}:{" "}
						<strong className="font-medium text-foreground">{actual}</strong>
						{goal ? ` / ${goal}` : ""}
					</span>
				))}
			</div>
		</div>
	);
}
