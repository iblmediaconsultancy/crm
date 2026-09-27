"use client";

import { Badge } from "@crm/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { Spinner } from "@crm/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { LocalDateTime, LocalRelativeTime } from "@/components/local-date-time";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

type Lead = RouterOutputs["operations"]["leadById"];
type Meta = Record<string, unknown>;

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
	dateStyle: "medium",
	timeStyle: "short",
};

const STAGE_LABELS: Record<Lead["stage"], string> = {
	NEW: "New",
	READY: "Ready",
	CONTACTED: "Contacted",
	REPLIED: "Replied",
	QUALIFIED: "Qualified",
	WARM: "Warm",
	MEETING: "Meeting",
	OPPORTUNITY: "Opportunity",
	WON: "Won",
	LOST: "Lost",
};

function metaValue(meta: unknown, key: string): string | null {
	if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
	const value = (meta as Meta)[key];
	return typeof value === "string" && value.trim() ? value : null;
}

function displayName(contact: Lead["contact"]): string {
	if (!contact) return "Unknown person";
	return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

export function LeadDetail({ leadId }: { leadId: string }) {
	const trpc = useTRPC();
	const workspaceUrl = useWorkspaceUrl();
	const query = useQuery(trpc.operations.leadById.queryOptions({ id: leadId }));

	if (query.isPending) {
		return (
			<div className="flex justify-center py-12">
				<Spinner size="lg" />
			</div>
		);
	}

	if (query.error || !query.data) {
		return (
			<Card>
				<CardContent className="py-12 text-center text-muted-foreground">
					This lead could not be loaded.
				</CardContent>
			</Card>
		);
	}

	const lead = query.data;
	const contactHref = lead.contact
		? workspaceUrl(`/contacts?record=contact:${lead.contact.id}`)
		: null;
	const companyHref = lead.company
		? workspaceUrl(`/companies?record=company:${lead.company.id}`)
		: null;
	const dealHref = lead.deal
		? workspaceUrl(`/deals?record=deal:${lead.deal.id}`)
		: null;

	return (
		<div className="grid gap-6">
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-center gap-2">
						<CardTitle className="text-lg">{lead.name}</CardTitle>
						<Badge variant="outline">{STAGE_LABELS[lead.stage]}</Badge>
						<Badge
							variant={
								lead.attentionState === "NEEDS_IHSAN"
									? "destructive"
									: "secondary"
							}
						>
							{lead.attentionState.replaceAll("_", " ")}
						</Badge>
						{lead.needsReview ? (
							<Badge variant="outline">Ihsan review</Badge>
						) : null}
					</div>
					<CardDescription>
						{lead.originChannel} · {lead.priority} priority · owned by{" "}
						{lead.owner.name}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<Info label="Person">
							{contactHref ? (
								<Link href={contactHref} className="hover:underline">
									{displayName(lead.contact)}
								</Link>
							) : (
								<EmptyCellValue />
							)}
						</Info>
						<Info label="Company / agency">
							{companyHref ? (
								<Link href={companyHref} className="hover:underline">
									{lead.company?.name}
								</Link>
							) : (
								<EmptyCellValue />
							)}
						</Info>
						<Info label="Opportunity">
							{dealHref ? (
								<Link href={dealHref} className="hover:underline">
									{lead.deal?.name}
								</Link>
							) : (
								<EmptyCellValue />
							)}
						</Info>
						<Info label="Last contact">
							{lead.lastContactedAt ? (
								<LocalRelativeTime date={lead.lastContactedAt} />
							) : (
								<EmptyCellValue />
							)}
						</Info>
						<Info label="Next action">
							{lead.nextActionTitle ? (
								<span>
									{lead.nextActionTitle}
									{lead.nextActionAt ? (
										<span className="block text-muted-foreground">
											<LocalDateTime
												date={lead.nextActionAt}
												options={DATE_OPTIONS}
											/>
										</span>
									) : null}
								</span>
							) : (
								<EmptyCellValue />
							)}
						</Info>
					</dl>
				</CardContent>
			</Card>

			<div className="grid gap-6 @3xl/page-content:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
				<Card>
					<CardHeader>
						<CardTitle>History</CardTitle>
						<CardDescription>
							Chronological imported messages, replies, handoffs and CRM
							activity.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{lead.activities.length === 0 &&
						lead.emailThreads.length === 0 &&
						lead.stageHistory.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								No activity has been recorded for this lead yet.
							</p>
						) : (
							<div className="grid gap-5">
								{lead.activities.map((activity) => {
									const activityMeta = (
										activity as unknown as { meta: unknown }
									).meta;
									const provenance = metaValue(activityMeta, "provenance");
									const channel = metaValue(activityMeta, "channel");
									const completeness = metaValue(
										activityMeta,
										"threadCompleteness",
									);
									return (
										<article
											key={activity.id}
											className="grid gap-1 border-b pb-4 last:border-0 last:pb-0"
										>
											<div className="flex flex-wrap items-center justify-between gap-2">
												<p className="font-medium text-sm">
													{activity.subject ?? activity.type}
												</p>
												<time className="text-muted-foreground text-xs">
													<LocalRelativeTime
														date={activity.occurredAt ?? activity.createdAt}
													/>
												</time>
											</div>
											{activity.body ? (
												<p className="whitespace-pre-wrap text-sm">
													{activity.body}
												</p>
											) : null}
											<div className="flex flex-wrap gap-1.5">
												{channel ? (
													<Badge variant="outline">{channel}</Badge>
												) : null}
												{provenance ? (
													<Badge variant="secondary">
														{provenance.replaceAll("_", " ")}
													</Badge>
												) : null}
												{completeness ? (
													<Badge variant="outline">Thread {completeness}</Badge>
												) : null}
												<Badge variant="outline">
													{activity.createdBy.name}
												</Badge>
											</div>
										</article>
									);
								})}
								{lead.emailThreads.flatMap((thread) =>
									thread.messages.map((message) => (
										<article
											key={message.id}
											className="grid gap-1 border-b pb-4 last:border-0 last:pb-0"
										>
											<div className="flex flex-wrap items-center justify-between gap-2">
												<p className="font-medium text-sm">
													{message.direction === "INBOUND"
														? "Inbound email"
														: "Outbound email"}
												</p>
												<LocalRelativeTime date={message.sentAt} />
											</div>
											<p className="text-muted-foreground text-xs">
												{message.fromName ?? message.fromEmail}
											</p>
											{(message.body ?? message.snippet) ? (
												<p className="whitespace-pre-wrap text-sm">
													{message.body ?? message.snippet}
												</p>
											) : null}
										</article>
									)),
								)}
								{lead.stageHistory.map((entry) => (
									<article
										key={entry.id}
										className="grid gap-1 border-b pb-4 last:border-0 last:pb-0"
									>
										<p className="font-medium text-sm">
											Stage changed to {STAGE_LABELS[entry.toStage]}
										</p>
										<p className="text-muted-foreground text-sm">
											{entry.reason ?? "No reason recorded."} ·{" "}
											{entry.actor.name}
										</p>
										<LocalDateTime
											date={entry.createdAt}
											options={DATE_OPTIONS}
										/>
									</article>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				<div className="grid content-start gap-6">
					<Card>
						<CardHeader>
							<CardTitle>Attention</CardTitle>
						</CardHeader>
						<CardContent className="text-sm">
							{lead.handoffReason ||
							lead.handoffSummary ||
							lead.handoffRecommendedAction ? (
								<div className="grid gap-3">
									{lead.handoffReason ? (
										<Info label="Why Atlas stopped">{lead.handoffReason}</Info>
									) : null}
									{lead.handoffSummary ? (
										<Info label="Summary">{lead.handoffSummary}</Info>
									) : null}
									{lead.handoffRecommendedAction ? (
										<Info label="Recommended action">
											{lead.handoffRecommendedAction}
										</Info>
									) : null}
								</div>
							) : (
								<p className="text-muted-foreground">
									No handoff notes recorded.
								</p>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Contact routes</CardTitle>
						</CardHeader>
						<CardContent className="grid gap-2 text-sm">
							{lead.contact?.contactRoutes.length ? (
								lead.contact.contactRoutes.map((route) => (
									<div
										key={route.id}
										className="flex items-start justify-between gap-3"
									>
										<span>{route.label ?? route.type}</span>
										<span className="break-all text-right text-muted-foreground">
											{route.value}
										</span>
									</div>
								))
							) : (
								<p className="text-muted-foreground">
									No active routes recorded.
								</p>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Provenance</CardTitle>
						</CardHeader>
						<CardContent className="grid gap-2 text-sm">
							<Info label="Source">{lead.source}</Info>
							<Info label="Origin channel">{lead.originChannel}</Info>
							<Info label="Source key">
								{lead.sourceKey ?? <EmptyCellValue />}
							</Info>
							<Info label="Created">
								{" "}
								<LocalDateTime date={lead.createdAt} options={DATE_OPTIONS} />
							</Info>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}

function Info({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="grid gap-1">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd>{children}</dd>
		</div>
	);
}
