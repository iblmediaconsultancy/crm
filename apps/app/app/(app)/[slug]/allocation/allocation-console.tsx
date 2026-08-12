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

type Entity =
	| "CONTACT"
	| "PLAYER"
	| "FOOTBALL_AGENT"
	| "COMPANY"
	| "AGENCY"
	| "CLUB"
	| "LEAD";
type Option = { id: string; label: string; entityType?: Entity };

export function AllocationConsole() {
	const trpc = useTRPC();
	const client = useQueryClient();
	const [entityGroup, setEntityGroup] = useState<
		"CONTACT" | "COMPANY" | "LEAD"
	>("CONTACT");
	const [selectedTarget, setSelectedTarget] = useState("");
	const [policyName, setPolicyName] = useState("");
	const [capacity, setCapacity] = useState("25");
	const [overrideUser, setOverrideUser] = useState("");
	const [reason, setReason] = useState("");
	const selectors = useQuery(
		trpc.operations.selectors.queryOptions({ q: "", take: 100, skip: 0 }),
	);
	const policies = useQuery(trpc.allocation.listPolicies.queryOptions());
	const overview = useQuery(trpc.allocation.overview.queryOptions());
	const targets: Option[] =
		entityGroup === "CONTACT"
			? (selectors.data?.contacts ?? []).map((row) => ({
					id: row.id,
					label: [row.firstName, row.lastName].filter(Boolean).join(" "),
					entityType: row.playerProfile
						? "PLAYER"
						: row.footballAgentProfile
							? "FOOTBALL_AGENT"
							: "CONTACT",
				}))
			: entityGroup === "COMPANY"
				? (selectors.data?.companies ?? []).map((row) => ({
						id: row.id,
						label: row.name,
						entityType: row.clubProfile
							? "CLUB"
							: row.agencyProfile
								? "AGENCY"
								: "COMPANY",
					}))
				: (selectors.data?.leads ?? []).map((row) => ({
						id: row.id,
						label: row.name,
						entityType: "LEAD",
					}));
	const target = targets.find((option) => option.id === selectedTarget);
	const entityType = target?.entityType ?? entityGroup;
	const preview = useQuery({
		...trpc.allocation.preview.queryOptions({
			entityType,
			entityId: selectedTarget || "pending",
		}),
		enabled: Boolean(selectedTarget),
	});
	const refresh = () => client.invalidateQueries();
	const create = useMutation(
		trpc.allocation.createPolicy.mutationOptions({
			onSuccess: async () => {
				toast.success("Policy version created.");
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const activate = useMutation(
		trpc.allocation.activatePolicy.mutationOptions({
			onSuccess: async () => {
				toast.success("Policy activated.");
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const enqueue = useMutation(
		trpc.allocation.enqueue.mutationOptions({
			onSuccess: async () => {
				toast.success("Allocation queued in PostgreSQL.");
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const override = useMutation(
		trpc.allocation.override.mutationOptions({
			onSuccess: async () => {
				toast.success("Manual override recorded.");
				await refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<div className="grid gap-4 xl:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle>Policy versions</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-3">
					<div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
						<Input
							placeholder="Policy name"
							value={policyName}
							onChange={(event) => setPolicyName(event.target.value)}
						/>
						<Input
							type="number"
							min={1}
							value={capacity}
							onChange={(event) => setCapacity(event.target.value)}
						/>
						<Button
							disabled={policyName.trim().length < 3}
							onClick={() =>
								create.mutate({
									name: policyName,
									rules: {
										priorityUserIds: [],
										defaultCapacity: Number(capacity),
									},
								})
							}
						>
							Create version
						</Button>
					</div>
					{policies.data?.map((policy) => (
						<div
							key={policy.id}
							className="flex items-center justify-between rounded-md border p-3"
						>
							<div>
								<p className="font-medium">
									v{policy.version} · {policy.name}
								</p>
								<p className="text-xs text-muted-foreground">
									Immutable policy version
								</p>
							</div>
							{policy.active ? (
								<Badge>Active</Badge>
							) : (
								<Button
									size="sm"
									variant="outline"
									onClick={() => activate.mutate({ policyId: policy.id })}
								>
									Activate
								</Button>
							)}
						</div>
					))}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Preview and allocate</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-3">
					<div className="grid gap-2 sm:grid-cols-2">
						<Choice
							value={entityGroup}
							onValueChange={(value) => {
								setEntityGroup(value as typeof entityGroup);
								setSelectedTarget("");
							}}
							options={[
								{ id: "CONTACT", label: "Contacts and football people" },
								{ id: "COMPANY", label: "Companies, clubs, and agencies" },
								{ id: "LEAD", label: "Leads" },
							]}
						/>
						<Choice
							value={selectedTarget}
							onValueChange={setSelectedTarget}
							placeholder="Choose a record"
							options={targets}
						/>
					</div>
					{preview.data ? (
						<div className="rounded-md border p-3">
							<p className="font-medium">
								{preview.data.assignee
									? `Suggested: ${preview.data.assignee.name}`
									: "Unallocated"}
							</p>
							<p className="text-sm text-muted-foreground">
								{preview.data.assignee
									? `${preview.data.assignee.activeLoad}/${preview.data.assignee.capacity} active load · deterministic policy result`
									: "No eligible recipient; the record remains in the explained unallocated queue."}
							</p>
						</div>
					) : null}
					<Button
						disabled={!selectedTarget}
						onClick={() =>
							enqueue.mutate({
								entityType,
								entityId: selectedTarget,
								idempotencyKey: crypto.randomUUID(),
							})
						}
					>
						Queue allocation
					</Button>
					<div className="border-t pt-3">
						<p className="mb-2 text-sm font-medium">Manual override</p>
						<div className="grid gap-2">
							<Choice
								value={overrideUser}
								onValueChange={setOverrideUser}
								placeholder="Choose an active member"
								options={(selectors.data?.members ?? []).map((row) => ({
									id: row.userId,
									label: `${row.user.name} · ${row.role}`,
								}))}
							/>
							<Input
								placeholder="Required override reason"
								value={reason}
								onChange={(event) => setReason(event.target.value)}
							/>
							<Button
								variant="outline"
								disabled={
									!selectedTarget || !overrideUser || reason.trim().length < 3
								}
								onClick={() =>
									override.mutate({
										entityType,
										entityId: selectedTarget,
										assigneeUserId: overrideUser,
										reason,
									})
								}
							>
								Record override
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Unallocated and failed work</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-2">
					{!overview.data?.unallocated.length ? (
						<p className="text-sm text-muted-foreground">
							No records currently need allocation attention.
						</p>
					) : (
						overview.data.unallocated.map((item) => (
							<div
								key={item.id}
								className="flex items-start justify-between gap-3 rounded-md border p-3"
							>
								<div>
									<p className="font-medium">{item.label}</p>
									<p className="text-xs text-muted-foreground">
										{item.entityType.replaceAll("_", " ")} · {item.reason} ·{" "}
										{item.attempts} attempts
									</p>
								</div>
								<Badge variant="outline">{item.status}</Badge>
							</div>
						))
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Active workload</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-2">
					{overview.data?.workload.map((member) => (
						<div
							key={member.userId}
							className="flex items-center justify-between rounded-md border p-3"
						>
							<div>
								<p className="font-medium">{member.name}</p>
								<p className="text-xs text-muted-foreground">
									{member.role} · {member.email}
								</p>
							</div>
							<Badge variant="secondary">{member.activeLoad} active</Badge>
						</div>
					))}
				</CardContent>
			</Card>
		</div>
	);
}

function Choice({
	value,
	onValueChange,
	options,
	placeholder = "Choose",
}: {
	value: string;
	onValueChange: (value: string) => void;
	options: Option[];
	placeholder?: string;
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
