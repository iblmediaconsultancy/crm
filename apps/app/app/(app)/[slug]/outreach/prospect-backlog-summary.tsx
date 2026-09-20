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
import { useTRPC } from "@/lib/trpc/client";

const states = [
	"NOT_REVIEWED",
	"REVIEWED",
	"NEEDS_ENRICHMENT",
	"ELIGIBLE",
	"READY",
	"CONTACTED",
	"REPLIED",
	"WARM",
	"WITH_IHSAN",
	"PARKED",
	"SUPPRESSED",
	"INVALID",
] as const;

function label(state: string): string {
	return state.replaceAll("_", " ");
}

export function ProspectBacklogSummary() {
	const trpc = useTRPC();
	const query = useQuery(trpc.operations.prospectBacklog.queryOptions());

	if (query.isPending) return null;
	if (!query.data) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Prospect backlog</CardTitle>
					<CardDescription>No workbook source batch is loaded.</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const { batch, counts, stateCounts, pilot } = query.data;
	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="grid gap-1">
						<CardTitle>Atlas prospect backlog</CardTitle>
						<CardDescription>
							Staged source records stay outside active Leads, pipeline and
							quota.
						</CardDescription>
					</div>
					<Badge variant="outline">Staged only</Badge>
				</div>
			</CardHeader>
			<CardContent className="grid gap-4">
				<div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
					<Summary
						label="Canonical prospects"
						value={counts.canonicalProspects}
					/>
					<Summary label="Source rows" value={counts.sourceRecords} />
					<Summary label="Shared routes" value={counts.sharedRoutes} />
					<Summary label="Ihsan review" value={counts.ambiguousIdentities} />
					<Summary label="Remaining" value={counts.remainingBacklog} />
				</div>
				<div className="grid gap-2 border-t pt-4 sm:grid-cols-3 lg:grid-cols-4">
					{states.map((state) => (
						<div
							className="flex items-center justify-between gap-3"
							key={state}
						>
							<span className="text-muted-foreground text-xs">
								{label(state)}
							</span>
							<strong className="tabular-nums">{stateCounts[state]}</strong>
						</div>
					))}
				</div>
				<div className="border-t pt-3 text-muted-foreground text-xs">
					{batch.filename} · imported{" "}
					{new Date(batch.importedAt).toLocaleDateString()} ·{" "}
					{batch.sourceSheetCount} sheets
				</div>
				{pilot ? (
					<details className="border-t pt-3">
						<summary className="cursor-pointer font-medium text-sm">
							{pilot.name} · {pilot.items.length} prepared candidates
						</summary>
						<div className="mt-3 grid gap-3">
							{pilot.items.map((candidate) => (
								<div
									className="grid gap-1 rounded-md border p-3"
									key={candidate.item.id}
								>
									<div className="flex flex-wrap items-baseline justify-between gap-2">
										<span className="font-medium text-sm">
											{candidate.rank}. {candidate.item.displayName}
										</span>
										<span className="text-muted-foreground text-xs">
											{candidate.language} · {candidate.routeVisibility.toLowerCase()} · {candidate.priority.toLowerCase()} · research {candidate.researchConfidence.toLowerCase()}
										</span>
									</div>
									<p className="text-muted-foreground text-xs">
										{candidate.item.agencyName ?? "No agency"} ·{" "}
										{candidate.whyNow}
									</p>
									<p className="text-muted-foreground text-xs">
										{candidate.ctaApproach} · route {candidate.routeConfidence.toLowerCase()}
									</p>
								</div>
							))}
						</div>
					</details>
				) : null}
			</CardContent>
		</Card>
	);
}

function Summary({ label, value }: { label: string; value: number }) {
	return (
		<div className="grid gap-1">
			<span className="text-muted-foreground text-xs">{label}</span>
			<strong className="text-lg tabular-nums">{value}</strong>
		</div>
	);
}
