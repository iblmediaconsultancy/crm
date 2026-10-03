import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db, Prisma } from "@crm/db";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { ConversionService } from "../src/currency/conversion.service";
import { DealsService } from "../src/deals/deals.service";
import { FieldsService } from "../src/fields/fields.service";
import { FinanceService } from "../src/finance/finance.service";

const suffix = process.env.TEST_RUN_ID ?? "finance-integrity-spec";
const domain = `finance-${suffix}.test`;
const userId = `finance-user-${suffix}`;
const currentMonthStart = new Date();
currentMonthStart.setUTCDate(1);
currentMonthStart.setUTCHours(0, 0, 0, 0);

const conversion = {
	reportingCurrency: async () => "EUR",
	rateFor: async () => ({
		rate: new Prisma.Decimal(1),
		asOf: new Date("2026-01-01T00:00:00.000Z"),
		origin: "IDENTITY" as const,
		provider: null,
	}),
} as unknown as ConversionService;

const permissions = { can: async () => true };
const stamp = new ActivityStampService(db);
const fields = new FieldsService(db, {} as never);
const deals = new DealsService(db, stamp, new ConversionService(db), fields);
const finance = new FinanceService(db, conversion, permissions as never);

let companyId: string;

async function clean() {
	const companies = await db.company.findMany({
		where: { domain },
		select: { id: true },
	});
	const ids = companies.map((company) => company.id);
	if (ids.length) {
		await db.activity.deleteMany({ where: { companyId: { in: ids } } });
		await db.deal.deleteMany({ where: { companyId: { in: ids } } });
		await db.company.deleteMany({ where: { id: { in: ids } } });
	}
	await db.companyExpense.deleteMany({ where: { createdByUserId: userId } });
	await db.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
	await clean();
	await db.user.create({
		data: { id: userId, name: "Finance Owner", email: `owner@${domain}` },
	});
	const company = await db.company.create({
		data: { name: "Finance Test Co", domain },
	});
	companyId = company.id;
});

afterAll(clean);

describe("finance integrity", () => {
	test("creates a financial profile when an opportunity closes won", async () => {
		const deal = await deals.create({
			name: "Recurring client",
			companyId,
			ownerId: userId,
			currency: "EUR",
			potentialPackageName: "Gold Representation",
			potentialMonthlyRevenueCents: 250000,
			potentialOneOffRevenueCents: 50000,
		});

		await deals.setStage({ id: deal.id, stage: "CLOSED_WON" }, userId);

		const profile = await db.clientFinancialProfile.findUnique({
			where: { dealId: deal.id },
			include: { events: true },
		});
		expect(profile?.billingStatus).toBe("ACTIVE");
		expect(profile?.packageName).toBe("Gold Representation");
		expect(profile?.monthlyFee?.toString()).toBe("2500");
		expect(profile?.oneOffRevenue?.toString()).toBe("500");
		expect(profile?.events).toHaveLength(1);
		expect(
			await db.deal.count({
				where: {
					id: deal.id,
					stage: {
						in: [
							"DEMO_BOOKED",
							"QUALIFIED_TO_BUY",
							"UNQUALIFIED_TO_BUY",
							"DECISION_MAKER_BOUGHT_IN",
							"CONTRACT_SENT",
						],
					},
				},
			}),
		).toBe(0);
	});

	test("records paid outstanding balance and preserves churn history", async () => {
		const profile = await finance.upsertProfile(userId, {
			companyId,
			currency: "EUR",
			monthlyFeeCents: 100000,
			outstandingAmountCents: 25000,
			billingStatus: "ACTIVE",
			paymentStatus: "PENDING",
		});
		await db.financialSnapshot.create({
			data: {
				financialProfileId: profile.id,
				periodStart: new Date("2026-01-01T00:00:00.000Z"),
				currency: "EUR",
				recurringRevenueBase: new Prisma.Decimal("1000"),
				estimatedProfitBase: new Prisma.Decimal("1000"),
			},
		});

		await finance.upsertProfile(userId, {
			id: profile.id,
			paymentStatus: "PAID",
		});
		const paid = await db.clientFinancialProfile.findUnique({
			where: { id: profile.id },
		});
		expect(paid?.outstandingAmount?.toString()).toBe("0");
		await finance.upsertProfile(userId, {
			id: profile.id,
			outstandingAmountCents: 30000,
		});
		const stillPaid = await db.clientFinancialProfile.findUnique({
			where: { id: profile.id },
		});
		expect(stillPaid?.outstandingAmount?.toString()).toBe("0");

		await finance.upsertProfile(userId, {
			id: profile.id,
			billingStatus: "ENDED",
		});
		const oldSnapshot = await db.financialSnapshot.findUnique({
			where: {
				financialProfileId_periodStart: {
					financialProfileId: profile.id,
					periodStart: new Date("2026-01-01T00:00:00.000Z"),
				},
			},
		});
		const events = await db.financialEvent.findMany({
			where: { financialProfileId: profile.id },
			orderBy: { occurredAt: "asc" },
		});
		expect(oldSnapshot?.recurringRevenueBase?.toString()).toBe("1000");
		expect(events.map((event) => event.type)).toContain(
			"PAYMENT_STATUS_CHANGED",
		);
		expect(events.map((event) => event.type)).toContain("CHURNED");
		expect(events.at(-1)?.payload).toMatchObject({ lostMrrBase: "1000" });
	});

	test("keeps the captured FX rate when a profile is updated", async () => {
		const company = await db.company.create({
			data: { name: "Frozen FX Co", domain },
		});
		let rate = new Prisma.Decimal("2");
		const frozenFinance = new FinanceService(
			db,
			{
				reportingCurrency: async () => "EUR",
				rateFor: async () => ({
					rate,
					asOf: new Date("2026-01-01T00:00:00.000Z"),
					origin: "MANUAL" as const,
					provider: null,
				}),
			} as unknown as ConversionService,
			permissions as never,
		);
		const profile = await frozenFinance.upsertProfile(userId, {
			companyId: company.id,
			currency: "USD",
			monthlyFeeCents: 10000,
			billingStatus: "ACTIVE",
		});
		rate = new Prisma.Decimal("4");
		await frozenFinance.upsertProfile(userId, {
			id: profile.id,
			paymentStatus: "CURRENT",
		});
		const updated = await db.clientFinancialProfile.findUnique({
			where: { id: profile.id },
		});
		expect(updated?.monthlyFeeBase?.toString()).toBe("200");
		expect(updated?.fxRate?.toString()).toBe("2");
	});

	test("captures and reads a company monthly snapshot", async () => {
		await finance.commandCenter(userId, "admin", { scope: "everyone" });
		const snapshot = await db.companyFinancialSnapshot.findUnique({
			where: {
				currency_periodStart: {
					currency: "EUR",
					periodStart: currentMonthStart,
				},
			},
		});
		const history = await finance.companyHistory(userId, "admin", {});
		expect(snapshot).not.toBeNull();
		expect(snapshot?.currency).toBe("EUR");
		expect(
			history?.some(
				(row) => row.periodStart === snapshot?.periodStart.toISOString(),
			),
		).toBe(true);
	});

	test("keeps the captured FX rate when an expense is edited", async () => {
		let rate = new Prisma.Decimal("2");
		const frozenFinance = new FinanceService(
			db,
			{
				reportingCurrency: async () => "EUR",
				rateFor: async () => ({
					rate,
					asOf: new Date("2026-01-01T00:00:00.000Z"),
					origin: "MANUAL" as const,
					provider: null,
				}),
			} as unknown as ConversionService,
			permissions as never,
		);
		const expense = await frozenFinance.upsertExpense(userId, {
			category: "Software",
			amountCents: 10000,
			currency: "USD",
			recurringMonthly: true,
			active: true,
			startDate: "2026-08-01T00:00:00.000Z",
		});
		rate = new Prisma.Decimal("4");
		await frozenFinance.upsertExpense(userId, {
			id: expense.id,
			category: "Software",
			amountCents: 10000,
			currency: "USD",
			recurringMonthly: true,
			active: false,
			startDate: "2026-08-01T00:00:00.000Z",
		});
		const updated = await db.companyExpense.findUnique({
			where: { id: expense.id },
		});
		expect(updated?.baseAmount?.toString()).toBe("200");
		expect(updated?.fxRate?.toString()).toBe("2");
	});
});
