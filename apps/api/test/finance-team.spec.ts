import { describe, expect, test } from "bun:test";
import { type Db, Prisma } from "@crm/db";
import { FinanceService } from "../src/finance/finance.service";

const conversion = {
	reportingCurrency: async () => "EUR",
} as never;

describe("finance team views", () => {
	test("derives owned weekly progress from CRM records and targets", async () => {
		const userId = "team-user";
		const service = new FinanceService(
			{
				user: {
					findMany: async ({ where }: { where: unknown }) => {
						expect(where).toEqual({ id: userId });
						return [{ id: userId, name: "Team User", image: null }];
					},
				},
				weeklyTarget: {
					findUnique: async () => ({
						id: "target-1",
						userId,
						weekStart: new Date("2026-08-24T00:00:00.000Z"),
						outreachContacts: 10,
						followUps: 4,
						qualifiedOpportunities: 2,
						proposals: 1,
						clientsClosed: 1,
						mrrGeneratedTargetBase: new Prisma.Decimal("1500"),
					}),
				},
				activity: {
					count: async ({ where }: { where: { createdById: string } }) => {
						expect(where.createdById).toBe(userId);
						return 3;
					},
				},
				operationalTask: {
					count: async ({
						where,
					}: {
						where: { assigneeUserId: string; status: unknown };
					}) => {
						expect(where.assigneeUserId).toBe(userId);
						return where.status === "DONE" ? 2 : 1;
					},
				},
				outboundDelivery: {
					count: async ({
						where,
					}: {
						where: { draft: { ownerUserId: string } };
					}) => {
						expect(where.draft.ownerUserId).toBe(userId);
						return 2;
					},
				},
				lead: {
					count: async ({ where }: { where: { ownerUserId: string } }) => {
						expect(where.ownerUserId).toBe(userId);
						return 1;
					},
				},
				proposal: {
					count: async ({ where }: { where: { ownerUserId: string } }) => {
						expect(where.ownerUserId).toBe(userId);
						return 1;
					},
				},
				deal: {
					count: async ({ where }: { where: { ownerId: string } }) => {
						expect(where.ownerId).toBe(userId);
						return 2;
					},
				},
				clientFinancialProfile: {
					findMany: async ({
						where,
					}: {
						where: { OR: Array<Record<string, unknown>> };
					}) => {
						expect(where.OR).toEqual([
							{ deal: { ownerId: userId } },
							{ company: { ownerId: userId } },
							{ contact: { ownerId: userId } },
						]);
						return [{ monthlyFeeBase: new Prisma.Decimal("1200") }];
					},
				},
			} as unknown as Db,
			conversion,
			{} as never,
		);

		const [row] = await service.performanceForViewer(userId, true);
		expect(row).toBeDefined();
		expect(row?.target?.outreachContacts).toBe(10);
		expect(row?.target?.mrrGeneratedTargetCents).toBe(150000);
		expect(row?.actual).toEqual({
			outreachContacts: 3,
			followUps: 2,
			followUpsDue: 1,
			positiveResponses: 2,
			qualifiedOpportunities: 1,
			proposals: 1,
			clientsClosed: 1,
			warmOpportunities: 2,
			mrrGeneratedCents: 120000,
		});
	});

	test("redacts costs and other-user compensation on the server", async () => {
		const service = new FinanceService(
			{
				clientFinancialProfile: {
					findUnique: async () => ({
						id: "profile-1",
						dealId: "deal-1",
						companyId: null,
						contactId: null,
						packageName: "Representation",
						currency: "EUR",
						baseCurrency: "EUR",
						fxRate: new Prisma.Decimal("1"),
						fxRateAt: new Date("2026-01-01T00:00:00.000Z"),
						billingStatus: "ACTIVE",
						paymentStatus: "CURRENT",
						contractStartDate: null,
						contractEndDate: null,
						monthlyFee: new Prisma.Decimal("1000"),
						directMonthlyCost: new Prisma.Decimal("200"),
						editorMonthlyCost: new Prisma.Decimal("100"),
						otherRecurringCost: new Prisma.Decimal("50"),
						onboardingFee: null,
						oneOffRevenue: new Prisma.Decimal("300"),
						additionalCharges: null,
						outstandingAmount: new Prisma.Decimal("125"),
						monthlyFeeBase: new Prisma.Decimal("1000"),
						directMonthlyCostBase: new Prisma.Decimal("200"),
						editorMonthlyCostBase: new Prisma.Decimal("100"),
						otherRecurringCostBase: new Prisma.Decimal("50"),
						onboardingFeeBase: null,
						oneOffRevenueBase: new Prisma.Decimal("300"),
						additionalChargesBase: null,
						outstandingAmountBase: new Prisma.Decimal("125"),
						commissions: [
							{
								id: "commission-own",
								userId: "viewer",
								user: { id: "viewer", name: "Viewer" },
								type: "PERCENTAGE",
								recurring: true,
								percentage: new Prisma.Decimal("10"),
								fixedAmount: null,
								fixedAmountBase: null,
								active: true,
							},
							{
								id: "commission-other",
								userId: "other",
								user: { id: "other", name: "Other" },
								type: "FIXED",
								recurring: true,
								percentage: null,
								fixedAmount: new Prisma.Decimal("25"),
								fixedAmountBase: new Prisma.Decimal("25"),
								active: true,
							},
						],
					}),
				},
			} as unknown as Db,
			conversion,
			{
				can: async (_userId: string, _role: string, permission: string) =>
					permission === "finance.client.pricing" ||
					permission === "finance.compensation.own",
			} as never,
		);

		const profile = await service.profile("viewer", "team", {
			id: "profile-1",
		});
		expect(profile?.monthlyFeeCents).toBe(100000);
		expect(profile?.directMonthlyCostCents).toBeNull();
		expect(profile?.estimatedMonthlyProfitCents).toBeNull();
		expect(profile?.commissions.map((commission) => commission.userId)).toEqual(
			["viewer"],
		);
	});
});
