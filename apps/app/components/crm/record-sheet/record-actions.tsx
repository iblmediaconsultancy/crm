"use client";

import OverflowMenuVertical from "@carbon/icons-react/es/OverflowMenuVertical";
import Renew from "@carbon/icons-react/es/Renew";
import TrashCan from "@carbon/icons-react/es/TrashCan";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@crm/ui/components/alert-dialog";
import { Button } from "@crm/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import {
	type RecordKind,
	type RecordRef,
	useRecordStack,
} from "./record-stack";

const NOUN: Record<RecordKind, string> = {
	company: "company",
	contact: "contact",
	deal: "deal",
};

export function RecordActions({
	record,
	name,
	version,
	lifecycleState,
}: {
	record: RecordRef;
	name: string;
	version: number;
	lifecycleState: "ACTIVE" | "ARCHIVED";
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const { close } = useRecordStack();
	const [confirming, setConfirming] = useState(false);
	const [destroying, setDestroying] = useState(false);
	const [reason, setReason] = useState("");
	const [destructionReason, setDestructionReason] = useState("");
	const [typedName, setTypedName] = useState("");
	const restoring = lifecycleState === "ARCHIVED";
	const workspace = useQuery(trpc.workspace.get.queryOptions());
	const lifecycleHandlers = {
		onSuccess: async () => {
			toast.success(
				`${name || `The ${NOUN[record.kind]}`} was ${restoring ? "restored" : "archived"}.`,
			);
			await cache[record.kind]();
			setConfirming(false);
			close();
		},
		onError: (error: { message: string }) => toast.error(error.message),
	};
	const lifecycleOptions =
		record.kind === "contact"
			? restoring
				? trpc.contacts.restore.mutationOptions(lifecycleHandlers)
				: trpc.contacts.archive.mutationOptions(lifecycleHandlers)
			: record.kind === "company"
				? restoring
					? trpc.companies.restore.mutationOptions(lifecycleHandlers)
					: trpc.companies.archive.mutationOptions(lifecycleHandlers)
				: restoring
					? trpc.deals.restore.mutationOptions(lifecycleHandlers)
					: trpc.deals.archive.mutationOptions(lifecycleHandlers);
	const lifecycleMutation = useMutation(lifecycleOptions);
	const impactOptions =
		record.kind === "contact"
			? trpc.contacts.destructionImpact.queryOptions({ id: record.id })
			: record.kind === "company"
				? trpc.companies.destructionImpact.queryOptions({ id: record.id })
				: trpc.deals.destructionImpact.queryOptions({ id: record.id });
	const impact = useQuery({ ...impactOptions, enabled: destroying });
	const destructionHandlers = {
		onSuccess: async () => {
			toast.success(`${name} was permanently destroyed and audited.`);
			await cache[record.kind]();
			setDestroying(false);
			close();
		},
		onError: (error: { message: string }) => toast.error(error.message),
	};
	const destructionOptions =
		record.kind === "contact"
			? trpc.contacts.destructiveDelete.mutationOptions(destructionHandlers)
			: record.kind === "company"
				? trpc.companies.destructiveDelete.mutationOptions(destructionHandlers)
				: trpc.deals.destructiveDelete.mutationOptions(destructionHandlers);
	const destruction = useMutation(destructionOptions);
	const verb = restoring ? "Restore" : "Archive";
	const dependencyTotal = impact.data
		? Object.values(impact.data.dependencies).reduce((sum, count) => sum + count, 0)
		: 0;
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						disabled={lifecycleMutation.isPending}
					>
						<Icon icon={OverflowMenuVertical} />
						<span className="sr-only">More actions</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-52">
					<DropdownMenuItem onSelect={() => setConfirming(true)}>
						<Icon icon={Renew} />
						{verb} {NOUN[record.kind]}
					</DropdownMenuItem>
					{workspace.data?.viewerRole === "admin" ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="text-destructive focus:text-destructive"
								onSelect={() => setDestroying(true)}
							>
								<Icon icon={TrashCan} />
								Permanently destroy
							</DropdownMenuItem>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
			<AlertDialog open={confirming} onOpenChange={setConfirming}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{verb} {name}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							{restoring
								? "Restoring makes the record available for normal CRM work again. Existing DNC state and cancelled outreach remain unchanged."
								: "Archiving removes the record from active workflows while preserving relationships, assignments, communications, and audit history."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<Input
						aria-label={`${verb} reason`}
						placeholder="Reason (required)"
						value={reason}
						onChange={(event) => setReason(event.target.value)}
					/>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={
								reason.trim().length < 3 || lifecycleMutation.isPending
							}
							onClick={() =>
								lifecycleMutation.mutate({ id: record.id, version, reason })
							}
						>
							{verb}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<AlertDialog open={destroying} onOpenChange={setDestroying}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Permanently destroy {name}?</AlertDialogTitle>
						<AlertDialogDescription>
							This exceptional Admin-only operation cannot be undone. The current
							impact preview found {dependencyTotal} dependent records. If the
							record or dependency set changes, confirmation will fail.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{impact.isLoading ? (
						<p className="text-sm text-muted-foreground">
							Generating a version-bound impact preview...
						</p>
					) : impact.isError ? (
						<p className="text-sm text-destructive">{impact.error.message}</p>
					) : (
						<div className="grid gap-3">
							<Input
								aria-label="Canonical name confirmation"
								placeholder={`Type ${name} exactly`}
								value={typedName}
								onChange={(event) => setTypedName(event.target.value)}
							/>
							<Input
								aria-label="Destruction reason"
								placeholder="Detailed reason (required)"
								value={destructionReason}
								onChange={(event) =>
									setDestructionReason(event.target.value)
								}
							/>
						</div>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={
								!impact.data ||
								typedName !== impact.data.name ||
								destructionReason.trim().length < 10 ||
								destruction.isPending
							}
							onClick={() => {
								if (!impact.data) return;
								destruction.mutate({
									id: record.id,
									confirmationToken: impact.data.confirmationToken,
									canonicalName: typedName,
									reason: destructionReason,
								});
							}}
						>
							Permanently destroy
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
