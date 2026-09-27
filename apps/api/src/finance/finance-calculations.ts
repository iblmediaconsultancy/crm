import { Prisma } from "@crm/db";

export type FinancialProfileTotalsInput = {
	monthlyFeeBase?: Prisma.Decimal | null;
	directMonthlyCostBase?: Prisma.Decimal | null;
	editorMonthlyCostBase?: Prisma.Decimal | null;
	otherRecurringCostBase?: Prisma.Decimal | null;
	onboardingFeeBase?: Prisma.Decimal | null;
	oneOffRevenueBase?: Prisma.Decimal | null;
	additionalChargesBase?: Prisma.Decimal | null;
	outstandingAmountBase?: Prisma.Decimal | null;
	commissions: Array<{
		type: "PERCENTAGE" | "FIXED";
		percentage: Prisma.Decimal | null;
		fixedAmountBase: Prisma.Decimal | null;
	}>;
};

export type PipelineTotalsInput = {
	potentialMonthlyRevenueBase?: Prisma.Decimal | null;
	potentialOneOffRevenueBase?: Prisma.Decimal | null;
	probability: number;
};

function sum(values: Array<Prisma.Decimal | null | undefined>): Prisma.Decimal {
	return values.reduce<Prisma.Decimal>(
		(total, value) => total.plus(value ?? 0),
		new Prisma.Decimal(0),
	);
}

export function financialTotals(
	profiles: FinancialProfileTotalsInput[],
	operatingCosts: Prisma.Decimal,
) {
	const mrr = sum(profiles.map((profile) => profile.monthlyFeeBase));
	const directClientCosts = sum(
		profiles.map((profile) =>
			sum([
				profile.directMonthlyCostBase,
				profile.editorMonthlyCostBase,
				profile.otherRecurringCostBase,
			]),
		),
	);
	const commissions = sum(
		profiles.flatMap((profile) =>
			profile.commissions.map((commission) =>
				commission.type === "PERCENTAGE"
					? (profile.monthlyFeeBase ?? new Prisma.Decimal(0))
							.mul(commission.percentage ?? 0)
							.div(100)
					: commission.fixedAmountBase,
			),
		),
	);
	const oneOffRevenue = sum(
		profiles.map((profile) =>
			sum([
				profile.onboardingFeeBase,
				profile.oneOffRevenueBase,
				profile.additionalChargesBase,
			]),
		),
	);
	const outstanding = sum(
		profiles.map((profile) => profile.outstandingAmountBase),
	);
	const revenue = sum([mrr, oneOffRevenue]);
	const profit = revenue
		.minus(directClientCosts)
		.minus(commissions)
		.minus(operatingCosts);
	return {
		mrr,
		directClientCosts,
		commissions,
		oneOffRevenue,
		outstanding,
		revenue,
		operatingCosts,
		profit,
		margin: margin(profit, revenue),
	};
}

export function pipelineTotals(deals: PipelineTotalsInput[]) {
	const totalMrr = sum(deals.map((deal) => deal.potentialMonthlyRevenueBase));
	const weightedMrr = sum(
		deals.map((deal) =>
			weightedPipelineAmount(
				deal.potentialMonthlyRevenueBase,
				deal.probability,
			),
		),
	);
	const totalOneOff = sum(deals.map((deal) => deal.potentialOneOffRevenueBase));
	return {
		totalMrr,
		weightedMrr,
		totalOneOff,
		warmOpportunities: deals.filter((deal) => deal.probability >= 50).length,
	};
}

export function mrrMovement(
	previousStatus: "NOT_STARTED" | "ACTIVE" | "PAUSED" | "ENDED" | null,
	previousMrr: Prisma.Decimal | null,
	currentStatus: "NOT_STARTED" | "ACTIVE" | "PAUSED" | "ENDED",
	currentMrr: Prisma.Decimal | null,
) {
	const previous =
		previousStatus === "ACTIVE"
			? (previousMrr ?? new Prisma.Decimal(0))
			: new Prisma.Decimal(0);
	const current =
		currentStatus === "ACTIVE"
			? (currentMrr ?? new Prisma.Decimal(0))
			: new Prisma.Decimal(0);
	return {
		newMrr: current.gt(previous)
			? current.minus(previous)
			: new Prisma.Decimal(0),
		lostMrr: previous.gt(current)
			? previous.minus(current)
			: new Prisma.Decimal(0),
	};
}

export function weightedPipelineAmount(
	amount: Prisma.Decimal | null | undefined,
	probability: number,
): Prisma.Decimal {
	if (!amount) return new Prisma.Decimal(0);
	return amount.times(Math.max(0, Math.min(probability, 100))).dividedBy(100);
}

export function margin(
	profit: Prisma.Decimal,
	revenue: Prisma.Decimal,
): number | null {
	return revenue.isZero() ? null : profit.dividedBy(revenue).toNumber();
}

export function goalProgress(
	target: Prisma.Decimal,
	current: Prisma.Decimal,
	createdAt: Date,
	deadline: Date,
	now = new Date(),
) {
	const remaining = Prisma.Decimal.max(target.minus(current), 0);
	const progress = target.isZero()
		? 1
		: Math.min(current.dividedBy(target).toNumber(), 1);
	const totalMs = Math.max(deadline.getTime() - createdAt.getTime(), 1);
	const elapsedMs = Math.max(
		Math.min(now.getTime() - createdAt.getTime(), totalMs),
		0,
	);
	const expectedProgress = elapsedMs / totalMs;
	const remainingMonths = Math.max(
		(deadline.getTime() - now.getTime()) / (30.4375 * 24 * 60 * 60 * 1000),
		0,
	);
	const requiredPace =
		remainingMonths === 0 ? remaining : remaining.dividedBy(remainingMonths);
	return {
		remaining,
		progress,
		expectedProgress,
		requiredPace,
		status:
			progress >= 1
				? "ahead"
				: progress > expectedProgress
					? "ahead"
					: progress >= expectedProgress
						? "on_track"
						: "behind",
	} as const;
}
