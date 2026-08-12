"use client";

import { authClient } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { useTRPC } from "@/lib/trpc/client";

export default function AcceptInvitationPage() {
	return (
		<Suspense
			fallback={
				<AuthShell>
					<AuthHeading
						title="Join IBL Command Center"
						description="Validating your invitation..."
					/>
				</AuthShell>
			}
		>
			<AcceptInvitationForm />
		</Suspense>
	);
}

function AcceptInvitationForm() {
	const id = useSearchParams().get("id") ?? "";
	const trpc = useTRPC();
	const invitation = useQuery({
		...trpc.onboarding.invitation.queryOptions({ invitationId: id }),
		enabled: id.length > 0,
	});
	const [password, setPassword] = useState("");
	const accept = useMutation(
		trpc.onboarding.accept.mutationOptions({
			onSuccess: async (result) => {
				const signIn = await authClient.signIn.email({
					email: result.email,
					password,
				});
				if (signIn.error) {
					toast.success("Account activated. Sign in to continue.");
					window.location.assign("/sign-in");
				} else {
					window.location.assign("/");
				}
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<AuthShell>
			<AuthHeading
				title="Join IBL Command Center"
				description={
					invitation.data
						? `${invitation.data.emailHint} · ${invitation.data.role}`
						: "Validate your invitation to continue."
				}
			/>
			{invitation.isError || !id ? (
				<p role="alert" className="text-center text-destructive text-sm">
					This invitation is invalid or has expired.
				</p>
			) : (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						accept.mutate({
							invitationId: id,
							name: String(form.get("name")),
							password,
						});
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel>Full name</FieldLabel>
							<Input name="name" autoComplete="name" required />
						</Field>
						<Field>
							<FieldLabel>Password</FieldLabel>
							<Input
								type="password"
								autoComplete="new-password"
								minLength={12}
								required
								value={password}
								onChange={(event) => setPassword(event.target.value)}
							/>
						</Field>
						<Button
							type="submit"
							disabled={!invitation.data || accept.isPending}
						>
							Activate account
						</Button>
					</FieldGroup>
				</form>
			)}
		</AuthShell>
	);
}
