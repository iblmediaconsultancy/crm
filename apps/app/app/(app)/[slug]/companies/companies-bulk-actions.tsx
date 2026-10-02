"use client";

import Renew from "@carbon/icons-react/es/Renew";
import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@crm/ui/components/dropdown-menu";
import { formatCount } from "@crm/ui/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
	BulkActionsMenu,
	BulkArchiveDialog,
	BulkOwnerMenu,
	reportBulk,
} from "@/components/crm/bulk-actions";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

function companies(count: number): string {
	return formatCount(count, "company", "companies");
}

export function CompaniesBulkActions({
	ids,
	onDone,
}: {
	ids: string[];
	onDone: () => void;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const users = useQuery(trpc.users.list.queryOptions());
	const [confirming, setConfirming] = useState(false);

	const onError = (error: { message: string }) => toast.error(error.message);

	const assignOwner = useMutation(
		trpc.companies.bulkAssignOwner.mutationOptions({
			onSuccess: async (result) => {
				await cache.company();
				reportBulk(result, (count) => `${companies(count)} reassigned.`);
				onDone();
			},
			onError,
		}),
	);

	const enrich = useMutation(
		trpc.companies.bulkEnrich.mutationOptions({
			onSuccess: async (result) => {
				await cache.company();
				reportBulk(
					result,
					(count) => `Looking up ${companies(count)} — the table will update.`,
				);
				onDone();
			},
			onError,
		}),
	);

	const remove = useMutation(
		trpc.companies.bulkArchive.mutationOptions({
			onSuccess: async (result, variables) => {
				await cache.removedMany({ kind: "company", ids: variables.ids });
				reportBulk(result, (count) => `${companies(count)} archived.`);
				setConfirming(false);
				onDone();
			},
			onError,
		}),
	);

	const pending = assignOwner.isPending || enrich.isPending || remove.isPending;

	return (
		<>
			<BulkActionsMenu pending={pending}>
				<BulkOwnerMenu
					users={users.data ?? []}
					unassignedLabel="Nobody"
					onSelect={(ownerId) => assignOwner.mutate({ ids, ownerId })}
				/>
				<DropdownMenuGroup>
					<DropdownMenuItem onSelect={() => enrich.mutate({ ids })}>
						<Renew />
						Re-enrich
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem onSelect={() => setConfirming(true)}>
						<Renew />
						Archive
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</BulkActionsMenu>

			<BulkArchiveDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={`Archive ${companies(ids.length)}?`}
				description="Archived records leave active workflows while relationships, communications, assignments, and audit history remain available."
				onConfirm={(reason) => remove.mutate({ ids, reason })}
			/>
		</>
	);
}
