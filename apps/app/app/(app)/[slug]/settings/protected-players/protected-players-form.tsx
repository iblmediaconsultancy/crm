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
import { Field, FieldDescription, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

export function ProtectedPlayersForm() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const nameId = useId();
	const reasonId = useId();
	const protections = useQuery(
		trpc.operations.playerProtections.queryOptions(),
	);
	const [displayName, setDisplayName] = useState("");
	const [reason, setReason] = useState("");
	const save = useMutation(
		trpc.operations.upsertPlayerProtection.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: trpc.operations.playerProtections.queryKey(),
				});
				setDisplayName("");
				setReason("");
				toast.success("Protected player saved.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const toggle = useMutation(
		trpc.operations.setPlayerProtectionActive.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: trpc.operations.playerProtections.queryKey(),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<div className="grid max-w-3xl gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Add a protected player</CardTitle>
					<CardDescription>
						This is a player-level prospecting safeguard. It does not mark an
						agency as suppressed or infer contract, payment, or client-status
						details.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="grid gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (!displayName.trim()) {
								toast.error("Enter a player name.");
								return;
							}
							save.mutate({
								displayName: displayName.trim(),
								reason: reason.trim() || null,
								source: "IHSAN_MANAGED",
								contactId: null,
							});
						}}
					>
						<Field>
							<FieldLabel htmlFor={nameId}>Player name</FieldLabel>
							<Input
								id={nameId}
								name="displayName"
								value={displayName}
								onChange={(event) => setDisplayName(event.target.value)}
								placeholder="Player name"
								autoComplete="off"
								disabled={save.isPending}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor={reasonId}>Reason</FieldLabel>
							<Input
								id={reasonId}
								name="reason"
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								placeholder="Optional context for Ihsan"
								disabled={save.isPending}
							/>
							<FieldDescription>
								Atlas will not prepare or send new-player outreach for active
								entries.
							</FieldDescription>
						</Field>
						<Button type="submit" disabled={save.isPending}>
							{save.isPending ? <Spinner data-icon="inline-start" /> : null}
							Save protection
						</Button>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Current protection list</CardTitle>
					<CardDescription>
						Inactive entries remain available for audit history and can be
						restored.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-2">
					<div className="sr-only" aria-live="polite">
						{protections.data?.length ?? 0} protected player entries
					</div>
					{protections.data?.map((protection) => (
						<div
							key={protection.id}
							className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
						>
							<div className="min-w-0">
								<div className="flex flex-wrap items-center gap-2">
									<strong className="font-medium">
										{protection.displayName}
									</strong>
									<Badge variant={protection.active ? "default" : "outline"}>
										{protection.active ? "Active" : "Inactive"}
									</Badge>
								</div>
								<p className="text-muted-foreground text-sm">
									{protection.reason ?? "No reason recorded."}
								</p>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={toggle.isPending}
								onClick={() =>
									toggle.mutate({
										id: protection.id,
										active: !protection.active,
									})
								}
							>
								{protection.active ? "Deactivate" : "Restore"}
							</Button>
						</div>
					))}
					{protections.data?.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							No protected players are configured.
						</p>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
