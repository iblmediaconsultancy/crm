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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

function formatLocalInput(date: Date) {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatAmsterdam(value: string | null) {
	if (!value) return "No expiry";
	return new Date(value).toLocaleString("en-GB", {
		timeZone: "Europe/Amsterdam",
		dateStyle: "medium",
		timeStyle: "short",
	});
}

export function AtlasAuthorizationControls() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const expiryId = useId();
	const reasonId = useId();
	const confirmationId = useId();
	const workspace = useQuery(trpc.workspace.get.queryOptions());
	const role = workspace.data?.viewerRole;
	const canManage = role === "admin" || role === "team";
	const authorizations = useQuery({
		...trpc.outreachLifecycle.listAtlasAuthorizations.queryOptions(),
		enabled: canManage,
	});
	const readiness = useQuery({
		...trpc.outreachLifecycle.atlasSystemReadiness.queryOptions(),
		enabled: canManage,
		refetchInterval: 30_000,
	});
	const [expiresAt, setExpiresAt] = useState("");
	const [reason, setReason] = useState("");
	const [confirmed, setConfirmed] = useState(false);
	const expiry = expiresAt ? new Date(expiresAt) : null;
	const validExpiry = Boolean(
		expiry &&
			Number.isFinite(expiry.getTime()) &&
			expiry.getTime() > Date.now(),
	);
	const issue = useMutation(
		trpc.outreachLifecycle.issueAtlasAuthorization.mutationOptions({
			onSuccess: async () => {
				toast.success("Atlas authorization issued.");
				setExpiresAt("");
				setConfirmed(false);
				await queryClient.invalidateQueries();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const revoke = useMutation(
		trpc.outreachLifecycle.revokeAtlasAuthorization.mutationOptions({
			onSuccess: async () => {
				toast.success("Atlas authorization revoked.");
				setReason("");
				await queryClient.invalidateQueries();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const dispatch = useMutation(
		trpc.outreachLifecycle.dispatchAtlasOutreach.mutationOptions({
			onSuccess: async () => {
				toast.success("Atlas Email cycle queued.");
				await queryClient.invalidateQueries();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!workspace.data || !canManage) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Atlas Email authorization</CardTitle>
				<CardDescription>
					Issue or revoke the scoped authorization through your signed-in
					account. This does not enable live outreach; the separate
					live-outreach gates still apply.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-5">
				<section
					className="grid gap-3 rounded-md border p-4"
					aria-labelledby="atlas-system-readiness"
				>
					<div className="grid gap-1">
						<h3 id="atlas-system-readiness" className="font-medium text-sm">
							Atlas system sender
						</h3>
						<p className="text-sm text-muted-foreground">
							This is Atlas’s verified system mailbox, separate from your
							personal mailbox. A cycle can start only when its provider,
							bridge, authorization and both live-outreach gates are ready.
						</p>
					</div>
					{readiness.isPending ? (
						<p className="text-sm text-muted-foreground" role="status">
							Checking Atlas system readiness.
						</p>
					) : readiness.error ? (
						<p className="text-sm text-destructive" role="alert">
							Unable to verify Atlas system readiness.
						</p>
					) : readiness.data ? (
						<>
							<div className="grid gap-2 text-sm sm:grid-cols-2">
								<p>
									Mailbox: {readiness.data.mailbox.status} ·{" "}
									{readiness.data.mailbox.address}
								</p>
								<p>Provider: {readiness.data.provider}</p>
								<p>Agent bridge: {readiness.data.bridge}</p>
								<p>PostgreSQL worker: {readiness.data.postgresWorker}</p>
								<p>Authorization: {readiness.data.authorization.status}</p>
								<p>Live outreach: {readiness.data.liveOutreach}</p>
								<p>Dispatch: {readiness.data.status}</p>
							</div>
							{readiness.data.blockers.length ? (
								<p className="text-xs text-muted-foreground">
									Blocked by: {readiness.data.blockers.join(", ")}
								</p>
							) : null}
							<div className="grid gap-2">
								<p className="text-xs text-muted-foreground">
									Running a cycle asks Atlas to review its eligible queue and
									may send one email if all runtime and per-send safeguards
									pass.
								</p>
								<Button
									disabled={
										readiness.data.status !== "READY" || dispatch.isPending
									}
									onClick={() => dispatch.mutate()}
								>
									{dispatch.isPending
										? "Queueing Atlas cycle…"
										: "Run Atlas Email cycle"}
								</Button>
							</div>
						</>
					) : null}
				</section>
				<form
					className="grid gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						if (!expiry || !validExpiry || !confirmed) return;
						issue.mutate({ expiresAt: expiry });
					}}
				>
					<div className="grid gap-2">
						<label className="text-sm font-medium" htmlFor={expiryId}>
							Expires at (Europe/Amsterdam)
						</label>
						<Input
							id={expiryId}
							type="datetime-local"
							min={formatLocalInput(new Date())}
							value={expiresAt}
							required
							onChange={(event) => setExpiresAt(event.target.value)}
						/>
					</div>
					<p className="text-xs text-muted-foreground">
						The selected local time is stored as an absolute expiry. A finite
						expiry is required.
					</p>
					<label
						className="flex items-start gap-2 text-sm"
						htmlFor={confirmationId}
					>
						<input
							id={confirmationId}
							type="checkbox"
							checked={confirmed}
							onChange={(event) => setConfirmed(event.target.checked)}
						/>
						<span>
							I understand this authorization does not turn on live outreach.
						</span>
					</label>
					<div>
						<Button
							type="submit"
							disabled={!validExpiry || !confirmed || issue.isPending}
						>
							Issue authorization
						</Button>
					</div>
				</form>

				<div className="grid gap-3">
					<h3 className="font-medium text-sm">Recent authorizations</h3>
					{authorizations.isPending ? (
						<p className="text-sm text-muted-foreground" role="status">
							Loading authorization history.
						</p>
					) : authorizations.error ? (
						<p className="text-sm text-destructive" role="alert">
							Unable to load authorization history.
						</p>
					) : authorizations.data?.length ? (
						authorizations.data.map((authorization) => {
							const expiresAtDate = authorization.expiresAt
								? new Date(authorization.expiresAt)
								: null;
							const expired =
								authorization.status === "ACTIVE" &&
								expiresAtDate !== null &&
								expiresAtDate.getTime() <= Date.now();
							return (
								<div
									key={authorization.id}
									className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_auto] sm:items-center"
								>
									<div className="grid gap-1">
										<div className="flex flex-wrap items-center gap-2">
											<Badge variant={expired ? "outline" : "secondary"}>
												{expired ? "EXPIRED" : authorization.status}
											</Badge>
											<span className="text-sm">{authorization.scope}</span>
										</div>
										<p className="text-xs text-muted-foreground">
											Issued by {authorization.authorizedBy.name} ·{" "}
											{formatAmsterdam(authorization.issuedAt)}
										</p>
										<p className="text-xs text-muted-foreground">
											Expires {formatAmsterdam(authorization.expiresAt)}
										</p>
										{authorization.revocationReason ? (
											<p className="text-xs text-muted-foreground">
												Revocation reason: {authorization.revocationReason}
											</p>
										) : null}
									</div>
									{authorization.status === "ACTIVE" ? (
										<Button
											variant="destructive"
											disabled={revoke.isPending || reason.trim().length < 3}
											onClick={() =>
												revoke.mutate({ id: authorization.id, reason })
											}
										>
											Revoke authorization
										</Button>
									) : null}
								</div>
							);
						})
					) : (
						<p className="text-sm text-muted-foreground">
							No Atlas authorizations are recorded.
						</p>
					)}
				</div>

				<div className="grid gap-2">
					<label className="text-sm font-medium" htmlFor={reasonId}>
						Reason for revocation
					</label>
					<Input
						id={reasonId}
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						minLength={3}
						maxLength={500}
						placeholder="Enter the reason before revoking an active authorization"
					/>
				</div>
			</CardContent>
		</Card>
	);
}
