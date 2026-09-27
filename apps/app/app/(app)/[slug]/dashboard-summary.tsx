"use client";

import { AtlasOperationsSummary } from "./atlas-operations-summary";
import { FinancialCommandCenter } from "./financial-command-center";

export function DashboardSummary() {
	return (
		<div className="flex flex-col gap-6">
			<FinancialCommandCenter compact />
			<AtlasOperationsSummary />
		</div>
	);
}
