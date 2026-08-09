"use client";

import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

type ProfileUpdate = {
	preferredLanguage: string;
	locale: string;
	timeZone: string;
	workingPreferences: Record<string, unknown>;
};

export function ProfileForm() {
	const trpc = useTRPC();
	const profile = useQuery(trpc.profile.get.queryOptions());
	const [language, setLanguage] = useState<string | null>(null);
	const [locale, setLocale] = useState<string | null>(null);
	const [timeZone, setTimeZone] = useState<string | null>(null);
	const update = useMutation({
		mutationFn: async (input: ProfileUpdate) => {
			const response = await fetch("/api/trpc/profile.updateOwn", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ json: input }),
			});
			if (!response.ok) throw new Error("Profile update was rejected.");
		},
		onSuccess: async () => {
			await profile.refetch();
			toast.success("Profile updated.");
		},
		onError: (error) => toast.error(error.message),
	});
	if (!profile.data) return null;
	return (
		<Card>
			<CardHeader>
				<CardTitle>Research identity</CardTitle>
				<CardDescription>
					These preferences are derived server-side for your Research Agent.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="grid max-w-xl gap-5"
					onSubmit={(event) => {
						event.preventDefault();
						update.mutate({
							preferredLanguage: language ?? profile.data.preferredLanguage,
							locale: locale ?? profile.data.locale,
							timeZone: timeZone ?? profile.data.timeZone,
							workingPreferences: profile.data.workingPreferences as Record<
								string,
								unknown
							>,
						});
					}}
				>
					<div className="grid gap-2">
						<Label htmlFor="language">Preferred language</Label>
						<Input
							id="language"
							value={language ?? profile.data.preferredLanguage}
							onChange={(event) => setLanguage(event.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="locale">Locale</Label>
						<Input
							id="locale"
							value={locale ?? profile.data.locale}
							onChange={(event) => setLocale(event.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="time-zone">Time zone</Label>
						<Input
							id="time-zone"
							value={timeZone ?? profile.data.timeZone}
							onChange={(event) => setTimeZone(event.target.value)}
						/>
					</div>
					<Button className="w-fit" type="submit" disabled={update.isPending}>
						Save profile
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
