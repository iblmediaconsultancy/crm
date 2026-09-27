import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, Prisma } from "@crm/db";
import { ConversionService } from "../src/currency/conversion.service";
import { DashboardService } from "../src/dashboard/dashboard.service";

const suffix = `${process.pid}-${Date.now()}`;
const userId = `dashboard-lifecycle-user-${suffix}`;
const domain = `dashboard-lifecycle-${suffix}.test`;

const dashboard = new DashboardService(db, new ConversionService(db));

let companyId: string;
let activeDealId: string;
let archivedDealId: string;

beforeAll(async () => {
	await db.user.create({
		data: {
			id: userId,
			name: "Dashboard Lifecycle Tester",
			email: `dashboard-lifecycle-${suffix}@${domain}`,
			emailVerified: true,
		},
	});

	const company = await db.company.create({
		data: { name: `Dashboard Lifecycle Company ${suffix}`, domain },
		select: { id: true },
	});
	companyId = company.id;

	const dealData = {
		companyId,
		ownerId: userId,
		stage: "DEMO_BOOKED" as const,
		amount: new Prisma.Decimal(1000),
		currency: "USD",
		baseAmount: new Prisma.Decimal(1000),
		baseCurrency: "USD",
	};

	const activeDeal = await db.deal.create({
		data: { ...dealData, name: `Active ${suffix}` },
		select: { id: true },
	});
	activeDealId = activeDeal.id;

	const archivedDeal = await db.deal.create({
		data: {
			...dealData,
			name: `Archived ${suffix}`,
			amount: new Prisma.Decimal(900),
			baseAmount: new Prisma.Decimal(900),
			lifecycleState: "ARCHIVED",
			archivedAt: new Date(),
			archiveReason: "Lifecycle regression test",
		},
		select: { id: true },
	});
	archivedDealId = archivedDeal.id;

	await db.activity.create({
		data: {
			type: "NOTE",
			subject: `Archived activity ${suffix}`,
			body: "Should not appear in the active dashboard.",
			dealId: archivedDealId,
			companyId,
			createdById: userId,
			lifecycleState: "ARCHIVED",
			archivedAt: new Date(),
			archiveReason: "Lifecycle regression test",
		},
	});
});

afterAll(async () => {
	await db.activity.deleteMany({
		where: { dealId: { in: [activeDealId, archivedDealId] } },
	});
	await db.deal.deleteMany({
		where: { id: { in: [activeDealId, archivedDealId] } },
	});
	await db.company.delete({ where: { id: companyId } });
	await db.user.delete({ where: { id: userId } });
});

describe("dashboard active lifecycle", () => {
	it("excludes archived deals and activities from active sales widgets", async () => {
		const summary = await dashboard.summary(userId, { scope: "me" });

		expect(summary.pipeline.totalDeals).toBe(1);
		expect(summary.biggestOpen.map((deal) => deal.id)).toEqual([activeDealId]);
		expect(
			summary.recentActivity.some((activity) =>
				activity.subject?.includes(suffix),
			),
		).toBe(false);
	});
});
