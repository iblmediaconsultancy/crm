"use client";

import { useQueryState } from "nuqs";
import { PageShellDescription, PageShellTitle } from "@/components/page-shell";
import { overviewParsers } from "./overview-search-params";

export function OverviewGreetingFallback() {
	return (
		<>
			<PageShellTitle>Welcome back</PageShellTitle>
			<PageShellDescription>
				What you have closed, what is still in play, and what needs you today.
			</PageShellDescription>
		</>
	);
}

export function OverviewGreeting() {
	const [scope] = useQueryState("scope", overviewParsers.scope);

	return (
		<>
			<PageShellTitle>Command Center</PageShellTitle>
			<PageShellDescription>
				{scope === "me"
					? "Your current business picture, pipeline and next decisions."
					: "The current IBL business picture, pipeline and next decisions."}
			</PageShellDescription>
		</>
	);
}
