"use client";

import { authClient } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { AuthHeading, AuthShell } from "@/components/auth-shell";

export default function ResetPasswordPage() {
	return (
		<Suspense
			fallback={
				<AuthShell>
					<AuthHeading
						title="Choose a new password"
						description="Validating your reset link..."
					/>
				</AuthShell>
			}
		>
			<ResetPasswordForm />
		</Suspense>
	);
}

function ResetPasswordForm() {
	const token = useSearchParams().get("token") ?? "";
	const [pending, setPending] = useState(false);

	return (
		<AuthShell>
			<AuthHeading
				title="Choose a new password"
				description="Use at least 12 characters."
			/>
			{token ? (
				<form
					onSubmit={async (event) => {
						event.preventDefault();
						setPending(true);
						const form = new FormData(event.currentTarget);
						const password = String(form.get("password"));
						const confirmation = String(form.get("confirmation"));
						if (password !== confirmation) {
							toast.error("Passwords do not match.");
							setPending(false);
							return;
						}
						const result = await authClient.resetPassword({
							token,
							newPassword: password,
						});
						setPending(false);
						if (result.error) {
							toast.error("This reset link is invalid or expired.");
						} else {
							toast.success("Password updated.");
							window.location.assign("/sign-in");
						}
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel>New password</FieldLabel>
							<Input
								type="password"
								name="password"
								autoComplete="new-password"
								minLength={12}
								required
							/>
						</Field>
						<Field>
							<FieldLabel>Confirm password</FieldLabel>
							<Input
								type="password"
								name="confirmation"
								autoComplete="new-password"
								minLength={12}
								required
							/>
						</Field>
						<Button type="submit" disabled={pending}>
							Reset password
						</Button>
					</FieldGroup>
				</form>
			) : (
				<p role="alert" className="text-center text-destructive text-sm">
					This reset link is invalid or expired.
				</p>
			)}
		</AuthShell>
	);
}
