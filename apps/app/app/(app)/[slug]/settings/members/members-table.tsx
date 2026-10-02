"use client";

import OverflowMenuHorizontal from "@carbon/icons-react/es/OverflowMenuHorizontal";
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
	DataTable,
	type DataTableColumn,
	type DataTableFacet,
} from "@crm/ui/components/data-table";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import { Icon } from "@crm/ui/components/icon";
import { PersonAvatar } from "@crm/ui/components/person-avatar";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ListSearch } from "@/components/data-table/list-search";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { LocalRelativeTime } from "@/components/local-date-time";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { membersSearchParams } from "./members-search-params";

const ROLE_LABEL = {
	admin: "Admin",
	team: "Team",
	contributor: "Contributor",
} as const;
type Role = keyof typeof ROLE_LABEL;
type MemberRow = RouterOutputs["workspace"]["members"]["rows"][number];
type Confirmation =
	| { kind: "remove"; member: MemberRow }
	| { kind: "transfer"; member: MemberRow; previousAdminId: string };

export function MembersTable() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const { query, input } = useTableQuery(membersSearchParams);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const workspace = useQuery(trpc.workspace.get.queryOptions());
	const members = useQuery({
		...trpc.workspace.members.queryOptions(input),
		placeholderData: (previous) => previous,
	});
	const success = async (message: string) => {
		setConfirmation(null);
		await cache.workspace();
		toast.success(message);
	};
	const failure = (error: { message: string }) => toast.error(error.message);
	const setRole = useMutation(
		trpc.workspace.setMemberRole.mutationOptions({
			onSuccess: () => success("Role changed."),
			onError: failure,
		}),
	);
	const setStatus = useMutation(
		trpc.workspace.setMemberStatus.mutationOptions({
			onSuccess: () => success("Member status changed."),
			onError: failure,
		}),
	);
	const remove = useMutation(
		trpc.workspace.removeMember.mutationOptions({
			onSuccess: () =>
				success(
					"Member access removed, sessions revoked, and history preserved.",
				),
			onError: failure,
		}),
	);
	const transfer = useMutation(
		trpc.workspace.transferAdmin.mutationOptions({
			onSuccess: () => success("Admin role transferred."),
			onError: failure,
		}),
	);
	const pending =
		setRole.isPending ||
		setStatus.isPending ||
		remove.isPending ||
		transfer.isPending;
	const canManage = workspace.data?.canChangeRoles ?? false;
	const viewerAdmin =
		members.data?.rows.find((row) => row.role === "admin" && row.isViewer) ??
		members.data?.rows.find((row) => row.role === "admin");
	const columns: DataTableColumn<MemberRow>[] = [
		{
			id: "name",
			header: "Name",
			sortable: true,
			hideable: false,
			width: "w-[28%]",
			cell: (row) => (
				<span className="flex min-w-0 items-center gap-2">
					<PersonAvatar
						size="sm"
						src={row.image}
						name={row.name}
						email={row.email}
					/>
					<span className="truncate font-medium">{row.name}</span>
					{row.isViewer ? (
						<span className="text-muted-foreground text-xs">You</span>
					) : null}
				</span>
			),
		},
		{
			id: "email",
			header: "Email",
			sortable: true,
			width: "w-[28%]",
			hideBelow: "md",
			cell: (row) => (
				<span className="truncate text-muted-foreground">{row.email}</span>
			),
		},
		{
			id: "role",
			header: "Role",
			sortable: true,
			width: "w-[12%]",
			cell: (row) => (
				<span className="text-muted-foreground">{ROLE_LABEL[row.role]}</span>
			),
		},
		{
			id: "status",
			header: "Status",
			width: "w-[12%]",
			cell: (row) => (
				<span
					className={
						row.status === "ACTIVE"
							? "text-muted-foreground"
							: "text-destructive"
					}
				>
					{row.status === "ACTIVE" ? "Active" : "Suspended"}
				</span>
			),
		},
		{
			id: "joinedAt",
			header: "Joined",
			sortable: true,
			align: "right",
			width: "w-[14%]",
			hideBelow: "sm",
			cell: (row) => (
				<span className="text-muted-foreground">
					<LocalRelativeTime date={row.joinedAt} />
				</span>
			),
		},
		{
			id: "actions",
			header: <span className="sr-only">Actions</span>,
			hideable: false,
			align: "right",
			width: "w-[6%]",
			cell: (row) =>
				canManage ? (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon" disabled={pending}>
								<Icon icon={OverflowMenuHorizontal} />
								<span className="sr-only">Manage {row.name}</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
								<DropdownMenuItem
									key={role}
									data-checked={row.role === role}
									onSelect={() =>
										row.role === role
											? undefined
											: setRole.mutate({ memberId: row.id, role })
									}
								>
									{ROLE_LABEL[role]}
								</DropdownMenuItem>
							))}
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onSelect={() =>
									setStatus.mutate({
										memberId: row.id,
										status: row.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
									})
								}
							>
								{row.status === "ACTIVE"
									? "Suspend access"
									: "Reactivate access"}
							</DropdownMenuItem>
							{row.role !== "admin" && viewerAdmin ? (
								<DropdownMenuItem
									onSelect={() =>
										setConfirmation({
											kind: "transfer",
											member: row,
											previousAdminId: viewerAdmin.id,
										})
									}
								>
									Transfer Admin role
								</DropdownMenuItem>
							) : null}
							{!row.isViewer ? (
								<DropdownMenuItem
									variant="destructive"
									onSelect={() =>
										setConfirmation({ kind: "remove", member: row })
									}
								>
									Remove access
								</DropdownMenuItem>
							) : null}
						</DropdownMenuContent>
					</DropdownMenu>
				) : null,
		},
	];
	const facets: DataTableFacet[] = [
		{
			id: "role",
			label: "Role",
			options: (Object.keys(ROLE_LABEL) as Role[]).flatMap((role) =>
				(members.data?.facetCounts.role?.[role] ?? 0) > 0
					? [{ value: role, label: ROLE_LABEL[role] }]
					: [],
			),
		},
	];
	return (
		<>
			<DataTable
				query={query}
				search={<ListSearch placeholder="Search by name or email..." />}
				columns={columns}
				rows={members.data?.rows ?? []}
				total={members.data?.total ?? 0}
				facetCounts={members.data?.facetCounts}
				facets={facets}
				getRowId={(row) => row.id}
				loading={members.isFetching}
				empty="Nobody matches this view."
			/>
			<AlertDialog
				open={confirmation !== null}
				onOpenChange={(open) => !open && setConfirmation(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirmation?.kind === "transfer"
								? `Transfer Admin to ${confirmation.member.name}?`
								: `Remove ${confirmation?.member.name ?? "this member"}'s access?`}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirmation?.kind === "transfer"
								? "The selected member becomes Admin and the current Admin becomes Contributor in one transaction."
								: "Their profile is suspended, every session is revoked, and active assignments are queued for PostgreSQL-backed reallocation. Authored CRM history is preserved."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={pending}
							onClick={() => {
								if (!confirmation) return;
								if (confirmation.kind === "transfer") {
									transfer.mutate({
										replacementMemberId: confirmation.member.id,
										previousMemberId: confirmation.previousAdminId,
									});
								} else {
									remove.mutate({ memberId: confirmation.member.id });
								}
							}}
						>
							{confirmation?.kind === "transfer"
								? "Transfer Admin"
								: "Remove access"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
