import { Badge } from "@crm/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import type { Metadata } from "next";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { OperationsActions } from "./operations-actions";

export const metadata: Metadata = { title: "Operations" };
export const instant = false;

const labels = {
	players: "Players",
	agents: "Football agents",
	agencies: "Agencies",
	clubs: "Clubs",
	representations: "Current representations",
	leads: "Open leads",
	tasks: "Open tasks",
	overdueTasks: "Overdue tasks",
	research: "Research queue",
	draftsInReview: "Drafts in review",
	proposalsInReview: "Proposals in review",
	duplicateCandidates: "Duplicate candidates",
} as const;

export default async function OperationsPage() {
	await requireSession();
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	const [overview, directory, workbench] = await Promise.all([
		queryClient.fetchQuery(trpc.operations.overview.queryOptions()),
		queryClient.fetchQuery(
			trpc.operations.directory.queryOptions({ q: "", take: 20 }),
		),
		queryClient.fetchQuery(
			trpc.operations.workbench.queryOptions({ q: "", take: 20 }),
		),
	]);

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Operations</PageShellTitle>
					<PageShellDescription>
						Football relationships, pipeline work, research evidence, drafting
						and human approval in one place.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<section
					aria-labelledby="operations-summary"
					className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
				>
					<h2 id="operations-summary" className="sr-only">
						Operational summary
					</h2>
					{Object.entries(labels).map(([key, label]) => (
						<Card key={key}>
							<CardHeader className="pb-2">
								<CardDescription className="block">{label}</CardDescription>
								<CardTitle className="text-2xl tabular-nums">
									{overview[key as keyof typeof overview]}
								</CardTitle>
							</CardHeader>
						</Card>
					))}
				</section>

				<OperationsActions />

				<div className="grid gap-4 xl:grid-cols-2">
					<Collection
						title="Football directory"
						description="Profile-backed people and organizations"
					>
						{directory.players.map((row) => (
							<Row
								key={`player-${row.contactId}`}
								title={[row.contact.firstName, row.contact.lastName]
									.filter(Boolean)
									.join(" ")}
								detail={row.position ?? "Player"}
								status="PLAYER"
							/>
						))}
						{directory.agents.map((row) => (
							<Row
								key={`agent-${row.contactId}`}
								title={[row.contact.firstName, row.contact.lastName]
									.filter(Boolean)
									.join(" ")}
								detail={row.agency?.company.name ?? "Independent"}
								status="AGENT"
							/>
						))}
						{directory.agencies.map((row) => (
							<Row
								key={`agency-${row.companyId}`}
								title={row.company.name}
								detail={`${row._count.agents} agents`}
								status="AGENCY"
							/>
						))}
						{directory.clubs.map((row) => (
							<Row
								key={`club-${row.companyId}`}
								title={row.company.name}
								detail={`${row._count.players} players`}
								status="CLUB"
							/>
						))}
					</Collection>

					<Collection
						title="Representations and routes"
						description="Explicit ownership and sharing"
					>
						{directory.representations.map((row) => (
							<Row
								key={row.id}
								title={`${row.player.firstName} → ${row.agent.firstName}`}
								detail={row.agency?.name ?? "No agency"}
								status={row.status}
							/>
						))}
						{directory.routes.map((row) => (
							<Row
								key={row.id}
								title={row.label ?? row.type}
								detail={row.contact?.firstName ?? row.company?.name ?? "Route"}
								status={row.visibility}
							/>
						))}
					</Collection>

					<Collection
						title="Pipeline and tasks"
						description="Linked work with exact record ownership"
					>
						{workbench.stages.map((row) => (
							<Row
								key={row.id}
								title={row.name}
								detail={`${row._count.deals} deals · ${row.probability}%`}
								status={row.kind}
							/>
						))}
						{workbench.leads.map((row) => (
							<Row
								key={row.id}
								title={row.name}
								detail={row.owner.name}
								status={row.status}
							/>
						))}
						{workbench.tasks.map((row) => (
							<Row
								key={row.id}
								title={row.title}
								detail={row.assignee.name}
								status={row.status}
							/>
						))}
					</Collection>

					<Collection
						title="Research and communications"
						description="Evidence first; outbound remains human controlled"
					>
						{workbench.research.map((row) => (
							<Row
								key={row.id}
								title={row.prompt}
								detail={`${row._count.findings} findings`}
								status={row.status}
							/>
						))}
						{workbench.drafts.map((row) => (
							<Row
								key={row.id}
								title={row.subject ?? "Untitled draft"}
								detail={
									row.outreachApproval ? "Approval requested" : "No approval"
								}
								status={row.status}
							/>
						))}
						{workbench.proposals.map((row) => (
							<Row
								key={row.id}
								title={row.title}
								detail={`${row._count.items} items`}
								status={row.status}
							/>
						))}
						{workbench.duplicates.map((row) => (
							<Row
								key={row.id}
								title={`${row.entityType} duplicate`}
								detail={`${row.leftEntityId} / ${row.rightEntityId}`}
								status="REVIEW"
							/>
						))}
					</Collection>
				</div>
			</PageShellContent>
		</PageShell>
	);
}

function Collection({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			<CardDescription className="block">{description}</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-2">
				{children}
				<p className="hidden only:block text-sm text-muted-foreground">
					No records yet.
				</p>
			</CardContent>
		</Card>
	);
}

function Row({
	title,
	detail,
	status,
}: {
	title: string;
	detail: string;
	status: string;
}) {
	return (
		<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border p-3">
			<div className="min-w-0">
				<p className="truncate font-medium text-sm">{title}</p>
				<p className="truncate text-muted-foreground text-xs">{detail}</p>
			</div>
			<Badge variant="outline">{status.replaceAll("_", " ")}</Badge>
		</div>
	);
}
