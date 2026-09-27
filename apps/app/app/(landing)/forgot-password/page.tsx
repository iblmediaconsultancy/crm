"use client";
import { authClient } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { useState } from "react";
import { AuthHeading, AuthShell } from "@/components/auth-shell";

export default function ForgotPasswordPage() {
	const [sent, setSent] = useState(false);
	const [pending, setPending] = useState(false);
	return (
		<AuthShell>
			<AuthHeading
				title="Reset your password"
				description="Enter your account email. If it is eligible, reset instructions will be queued."
			/>
			{sent ? (
				<p className="text-center text-muted-foreground text-sm">
					If an eligible account exists, reset instructions are on their way.
				</p>
			) : (
				<form
					onSubmit={async (event) => {
						event.preventDefault();
						setPending(true);
						const form = new FormData(event.currentTarget);
						await authClient
							.requestPasswordReset({
								email: String(form.get("email")),
								redirectTo: "/reset-password",
							})
							.catch(() => undefined);
						setPending(false);
						setSent(true);
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel>Email</FieldLabel>
							<Input type="email" name="email" autoComplete="email" required />
						</Field>
						<Button type="submit" disabled={pending}>
							Send reset instructions
						</Button>
					</FieldGroup>
				</form>
			)}
		</AuthShell>
	);
}
