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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

type MailboxVerificationStatus = {
	id: string;
	address: string;
	status: string;
	verifiedAt: string | Date | null;
};

export function MailboxVerification({
	mailbox,
	canVerify,
}: {
	mailbox: MailboxVerificationStatus | null;
	canVerify: boolean;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const verify = useMutation(
		trpc.providerCapabilities.verifyMailbox.mutationOptions({
			onSuccess: async () => {
				toast.success("outreach@iblmedia.com is verified.");
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.providerCapabilities.mailboxVerification.pathKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.providerCapabilities.get.pathKey(),
					}),
				]);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>MIAB outreach mailbox</CardTitle>
				<CardDescription>
					The mailbox can be verified only after the read-only MIAB provider
					probe succeeds.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-wrap items-center gap-3">
				{mailbox ? (
					<>
						<span className="text-sm">{mailbox.address}</span>
						<Badge
							variant={mailbox.status === "VERIFIED" ? "default" : "outline"}
						>
							{mailbox.status}
						</Badge>
						{canVerify && mailbox.status !== "VERIFIED" ? (
							<Button
								disabled={verify.isPending}
								onClick={() => verify.mutate({})}
							>
								Mark mailbox verified
							</Button>
						) : null}
					</>
				) : (
					<span className="text-muted-foreground text-sm">
						The seeded outreach mailbox is not present.
					</span>
				)}
			</CardContent>
		</Card>
	);
}
