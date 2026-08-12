"use client";

import { signIn } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { Spinner } from "@crm/ui/components/spinner";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

export function EmailSignIn() {
	const [pending, setPending] = useState(false);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);
		const data = new FormData(event.currentTarget);
		const result = await signIn.email({
			email: String(data.get("email") ?? ""),
			password: String(data.get("password") ?? ""),
			callbackURL: "/",
		});
		if (result.error) {
			setPending(false);
			toast.error(result.error.message ?? "Sign-in failed.");
		}
	}

	return (
		<form
			className="flex flex-col gap-5"
			onSubmit={(event) => void submit(event)}
		>
			<div className="grid gap-2">
				<Label htmlFor="email">Email</Label>
				<Input
					id="email"
					name="email"
					type="email"
					autoComplete="email"
					required
				/>
			</div>
			<div className="grid gap-2">
				<Label htmlFor="password">Password</Label>
				<Input
					id="password"
					name="password"
					type="password"
					autoComplete="current-password"
					minLength={8}
					required
				/>
			</div>
			<Button type="submit" disabled={pending}>
				{pending ? <Spinner data-icon="inline-start" /> : null}
				Sign in
			</Button>
			<p className="text-center text-muted-foreground text-xs">
				Invite-only. <Link className="underline underline-offset-3 hover:text-foreground" href="/forgot-password">Forgot password?</Link>
			</p>
		</form>
	);
}
