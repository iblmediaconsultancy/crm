import { describe, expect, test } from "bun:test";
import { type Db, Prisma } from "@crm/db";
import { FinanceService } from "../src/finance/finance.service";
import {
	financialTotals,
	goalProgress,
	margin,
	mrrMovement,
	pipelineTotals,
	weightedPipelineAmount,
} from "../src/finance/finance-calculations";

describe("finance calculations", () => {
	test("weights pipeline value by probability", () => {
		expect(
			weightedPipelineAmount(new Prisma.Decimal("1000"), 60).toString(),
		).toBe("600");
		expect(
			weightedPipelineAmount(new Prisma.Decimal("1000"), 140).toString(),
		).toBe("1000");
	});

	test("returns a null margin when revenue is zero", () => {
		expect(
			margin(new Prisma.Decimal("10"), new Prisma.Decimal("0")),
		).toBeNull();
		expect(margin(new Prisma.Decimal("250"), new Prisma.Decimal("1000"))).toBe(
			0.25,
		);
	});

	test("derives MRR, non-recurring revenue, outstanding balance, costs and profit", () => {
		const totals = financialTotals(
			[
				{
					monthlyFeeBase: new Prisma.Decimal("1000"),
					onboardingFeeBase: new Prisma.Decimal("250"),
					directMonthlyCostBase: new Prisma.Decimal("200"),
					editorMonthlyCostBase: new Prisma.Decimal("100"),
					otherRecurringCostBase: new Prisma.Decimal("50"),
					oneOffRevenueBase: new Prisma.Decimal("100"),
					additionalChargesBase: new Prisma.Decimal("20"),
					outstandingAmountBase: new Prisma.Decimal("60"),
					commissions: [
						{
							type: "PERCENTAGE",
							percentage: new Prisma.Decimal("10"),
							fixedAmountBase: null,
						},
						{
							type: "FIXED",
							percentage: null,
							fixedAmountBase: new Prisma.Decimal("25"),
						},
					],
				},
			],
			new Prisma.Decimal("150"),
		);
		expect(totals.mrr.toString()).toBe("1000");
		expect(totals.oneOffRevenue.toString()).toBe("370");
		expect(totals.outstanding.toString()).toBe("60");
		expect(totals.directClientCosts.toString()).toBe("350");
		expect(totals.commissions.toString()).toBe("125");
		expect(totals.profit.toString()).toBe("745");
	});

	test("derives total and weighted pipeline value", () => {
		const totals = pipelineTotals([
			{
				potentialMonthlyRevenueBase: new Prisma.Decimal("1000"),
				potentialOneOffRevenueBase: new Prisma.Decimal("300"),
				probability: 50,
			},
			{
				potentialMonthlyRevenueBase: new Prisma.Decimal("500"),
				potentialOneOffRevenueBase: null,
				probability: 20,
			},
		]);
		expect(totals.totalMrr.toString()).toBe("1500");
		expect(totals.weightedMrr.toString()).toBe("600");
		expect(totals.totalOneOff.toString()).toBe("300");
		expect(totals.warmOpportunities).toBe(1);
	});

	test("updates weighted pipeline when probability changes", () => {
		const deal = {
			potentialMonthlyRevenueBase: new Prisma.Decimal("1000"),
			potentialOneOffRevenueBase: null,
			probability: 40,
		};
		expect(pipelineTotals([deal]).weightedMrr.toString()).toBe("400");
		deal.probability = 80;
		expect(pipelineTotals([deal]).weightedMrr.toString()).toBe("800");
	});

	test("records new and lost MRR movement", () => {
		const churn = mrrMovement(
			"ACTIVE",
			new Prisma.Decimal("1000"),
			"ENDED",
			null,
		);
		const expansion = mrrMovement(
			"ACTIVE",
			new Prisma.Decimal("1000"),
			"ACTIVE",
			new Prisma.Decimal("1300"),
		);
		expect(churn.lostMrr.toString()).toBe("1000");
		expect(churn.newMrr.toString()).toBe("0");
		expect(expansion.newMrr.toString()).toBe("300");
		expect(expansion.lostMrr.toString()).toBe("0");
	});

	test("calculates goal gap and pace", () => {
		const createdAt = new Date("2026-01-01T00:00:00.000Z");
		const deadline = new Date("2026-07-01T00:00:00.000Z");
		const result = goalProgress(
			new Prisma.Decimal("10000"),
			new Prisma.Decimal("5000"),
			createdAt,
			deadline,
			new Date("2026-04-01T00:00:00.000Z"),
		);
		expect(result.progress).toBe(0.5);
		expect(result.remaining.toString()).toBe("5000");
		expect(result.status).toBe("ahead");
		expect(
			goalProgress(
				new Prisma.Decimal("18100"),
				new Prisma.Decimal("9000"),
				createdAt,
				deadline,
				new Date("2026-04-01T00:00:00.000Z"),
			).status,
		).toBe("on_track");
		expect(
			goalProgress(
				new Prisma.Decimal("10000"),
				new Prisma.Decimal("9000"),
				createdAt,
				deadline,
				new Date("2026-04-01T00:00:00.000Z"),
			).status,
		).toBe("ahead");
		expect(
			goalProgress(
				new Prisma.Decimal("10000"),
				new Prisma.Decimal("1000"),
				createdAt,
				deadline,
				new Date("2026-04-01T00:00:00.000Z"),
			).status,
		).toBe("behind");
	});

	test("preserves goal milestones in the viewer result", async () => {
		const service = new FinanceService(
			{
				companyGoal: {
					findMany: async () => [
						{
							id: "goal-1",
							type: "MRR",
							name: "Annual MRR",
							targetAmountBase: new Prisma.Decimal("10000"),
							currency: "EUR",
							deadline: new Date("2026-12-31T00:00:00.000Z"),
							milestones: [
								{
									date: "2026-09-30T00:00:00.000Z",
									targetAmountCents: 250000,
								},
							],
							active: true,
							createdAt: new Date("2026-01-01T00:00:00.000Z"),
						},
					],
				},
			} as unknown as Db,
			{} as never,
			{} as never,
		);

		const [goal] = await service.goals("EUR", new Prisma.Decimal("5000"), true);
		expect(goal?.milestones).toEqual([
			{
				date: "2026-09-30T00:00:00.000Z",
				targetAmountCents: 250000,
			},
		]);
	});
});
