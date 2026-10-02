import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { EmailSignIn } from "./email-sign-in";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
	return (
		<AuthShell>
			<Suspense
				fallback={
					<AuthHeading
						title="Welcome back"
						description="Sign in with your account to continue."
					/>
				}
			>
				<EmailSignIn />
			</Suspense>
		</AuthShell>
	);
}
