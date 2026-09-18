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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

type CalendarStatus = {
	configured: boolean;
	linked: boolean;
	connected: boolean;
	readAccess: boolean;
	writeAccess: boolean;
	hasRefreshToken: boolean;
	redirectUri: string;
	primaryCalendarId: string;
	hvaCalendarId: string | null;
	blockedCalendarIds: string[];
};

export function GoogleCalendarConnection({
	initial,
}: {
	initial: CalendarStatus;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const pathname = usePathname();
	const status = useQuery({
		...trpc.meetings.status.queryOptions(),
		initialData: initial,
	});
	const disconnect = useMutation(
		trpc.meetings.disconnect.mutationOptions({
			onSuccess: async () => {
				toast.success("Google Calendar disconnected.");
				await queryClient.invalidateQueries({
					queryKey: trpc.meetings.status.pathKey(),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const connectHref = `/api/integrations/google-calendar/connect?returnTo=${encodeURIComponent(pathname)}`;
	const value = status.data ?? initial;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between gap-4">
					<div>
						<CardTitle>Google Calendar</CardTitle>
						<CardDescription>
							Used for availability checks and approved meeting creation.
						</CardDescription>
					</div>
					<Badge variant={value.connected ? "default" : "outline"}>
						{value.connected ? "Connected" : "Not connected"}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="grid gap-4">
				<div className="grid gap-2 text-sm text-muted-foreground">
					<span>
						Read access: {value.readAccess ? "Granted" : "Not granted"}
					</span>
					<span>
						Write access: {value.writeAccess ? "Granted" : "Not granted"}
					</span>
					<span>HvA calendar: {value.hvaCalendarId ?? "Not configured"}</span>
				</div>
				{!value.configured ? (
					<p className="text-sm text-muted-foreground">
						Google Calendar OAuth credentials are not configured yet.
					</p>
				) : null}
				<div className="flex flex-wrap gap-2">
					<Button asChild disabled={!value.configured}>
						<Link href={connectHref}>
							{value.connected
								? "Reconnect Google Calendar"
								: "Connect Google Calendar"}
						</Link>
					</Button>
					{value.linked ? (
						<Button
							variant="outline"
							disabled={disconnect.isPending}
							onClick={() => disconnect.mutate()}
						>
							Disconnect
						</Button>
					) : null}
				</div>
				<p className="text-muted-foreground text-xs">
					Redirect URI: {value.redirectUri}
				</p>
			</CardContent>
		</Card>
	);
}
