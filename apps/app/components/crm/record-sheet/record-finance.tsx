"use client";

import { Button } from "@crm/ui/components/button";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { formatMoney } from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import {
	DetailSheetBody,
	DetailSheetProperties,
	DetailSheetProperty,
	DetailSheetSection,
} from "@/components/detail-sheet";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { useOpenRecord } from "./record-stack";

type FinanceProfile = RouterOutputs["finance"]["profiles"][number];

export function RecordFinance({
	dealId,
	companyId,
	contactId,
}: {
	dealId?: string;
	companyId?: string;
	contactId?: string;
}) {
	const trpc = useTRPC();
	const query = useQuery(
		trpc.finance.profiles.queryOptions({ dealId, companyId, contactId }),
	);

	if (query.isPending)
		return (
			<DetailSheetBody>
				<DetailSheetSection title="Financial profile">
					Loading financial details…
				</DetailSheetSection>
			</DetailSheetBody>
		);

	if (!query.data?.length)
		return (
			<DetailSheetBody>
				<DetailSheetSection title="Financial profile">
					<p className="text-muted-foreground text-sm">
						No financial profile is available for this relationship, or it is
						restricted by your permissions.
					</p>
				</DetailSheetSection>
			</DetailSheetBody>
		);

	return (
		<DetailSheetBody>
			{query.data.map((profile) => (
				<ProfileDetails key={profile.id} profile={profile} />
			))}
		</DetailSheetBody>
	);
}

function ProfileDetails({ profile }: { profile: NonNullable<FinanceProfile> }) {
	const openRecord = useOpenRecord();
	const money = (value: number | null) =>
		value === null ? <EmptyCellValue /> : formatMoney(value, profile.currency);

	return (
		<>
			<DetailSheetSection title="Financial profile">
				<DetailSheetProperties>
					<DetailSheetProperty label="Package">
						{profile.packageName ?? <EmptyCellValue />}
					</DetailSheetProperty>
					<DetailSheetProperty label="Billing">
						{profile.billingStatus.replaceAll("_", " ")}
					</DetailSheetProperty>
					<DetailSheetProperty label="Monthly fee">
						{money(profile.monthlyFeeCents)}
					</DetailSheetProperty>
					<DetailSheetProperty label="Direct recurring cost">
						{money(profile.directMonthlyCostCents)}
					</DetailSheetProperty>
					<DetailSheetProperty label="Commissions" wide>
						{profile.commissions.length ? (
							<div className="grid gap-1">
								{profile.commissions.map((commission) => (
									<div key={commission.id} className="flex flex-wrap gap-x-2">
										<span>{commission.userName}</span>
										<span className="text-muted-foreground">
											{commission.type === "PERCENTAGE"
												? `${commission.percentage ?? 0}%`
												: commission.fixedAmountCents === null
													? "Fixed amount not available"
													: formatMoney(
															commission.fixedAmountCents,
															commission.currency,
														)}{" "}
											{commission.recurring ? "recurring" : "one-off"}
										</span>
									</div>
								))}
							</div>
						) : (
							<EmptyCellValue />
						)}
					</DetailSheetProperty>
					<DetailSheetProperty label="One-off work">
						{money(profile.oneOffRevenueCents)}
					</DetailSheetProperty>
					<DetailSheetProperty label="Outstanding">
						{money(profile.outstandingAmountCents)}
					</DetailSheetProperty>
					<DetailSheetProperty label="Estimated monthly profit">
						{money(profile.estimatedMonthlyProfitCents)}
					</DetailSheetProperty>
					<DetailSheetProperty label="Estimated margin">
						{profile.estimatedMargin === null ? (
							<EmptyCellValue />
						) : (
							`${Math.round(profile.estimatedMargin * 100)}%`
						)}
					</DetailSheetProperty>
				</DetailSheetProperties>
			</DetailSheetSection>
			<DetailSheetSection title="Editing">
				<p className="text-muted-foreground text-sm">
					Admins can update pricing, costs and payment status from the related
					deal&apos;s Finance tab.
				</p>
				{profile.dealId ? (
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							openRecord({ kind: "deal", id: profile.dealId as string })
						}
					>
						Open related deal
					</Button>
				) : null}
			</DetailSheetSection>
		</>
	);
}
