import { type Db, Prisma } from "@crm/db";
import { OPEN_DEAL_STAGES } from "@crm/db/deal-stage";
import { applyRate } from "@crm/db/fx";
import { WORKSPACE_ID } from "@crm/db/workspace";
import { Injectable, NotFoundException } from "@nestjs/common";
import { decimalFromCents, toCents } from "../crm/values";
import { ConversionService } from "../currency/conversion.service";
import { InjectDatabase } from "../database/database.constants";
import { PermissionAccessService } from "../workspace/permission-access.service";
import type {
	CommissionUpsertInput,
	CompanyHistoryInput,
	ExpenseListInput,
	ExpenseUpsertInput,
	FinanceDashboardInput,
	FinancialHistoryInput,
	FinancialProfileByRecordInput,
	FinancialProfilesByRecordInput,
	FinancialProfileUpsertInput,
	GoalInput,
	PermissionOverrideInput,
	WeeklyTargetInput,
} from "./finance.contracts";
import {
	financialTotals as calculateFinancialTotals,
	goalProgress,
	margin,
	mrrMovement,
	pipelineTotals,
} from "./finance-calculations";

const MONEY_FIELDS = [
	"monthlyFee",
	"directMonthlyCost",
	"editorMonthlyCost",
	"otherRecurringCost",
	"onboardingFee",
	"oneOffRevenue",
	"additionalCharges",
	"outstandingAmount",
] as const;

const BASE_FIELDS = {
	monthlyFee: "monthlyFeeBase",
	directMonthlyCost: "directMonthlyCostBase",
	editorMonthlyCost: "editorMonthlyCostBase",
	otherRecurringCost: "otherRecurringCostBase",
	onboardingFee: "onboardingFeeBase",
	oneOffRevenue: "oneOffRevenueBase",
	additionalCharges: "additionalChargesBase",
	outstandingAmount: "outstandingAmountBase",
} as const;

type MoneyField = (typeof MONEY_FIELDS)[number];

export type FinancialProfileView = {
	[key: string]: unknown;
	id: string;
	dealId: string | null;
	companyId: string | null;
	contactId: string | null;
	packageName: string | null;
	currency: string;
	billingStatus: string;
	paymentStatus: string;
	contractStartDate: string | null;
	contractEndDate: string | null;
	monthlyFeeCents: number | null;
	directMonthlyCostCents: number | null;
	editorMonthlyCostCents: number | null;
	otherRecurringCostCents: number | null;
	onboardingFeeCents: number | null;
	oneOffRevenueCents: number | null;
	additionalChargesCents: number | null;
	outstandingAmountCents: number | null;
	estimatedMonthlyProfitCents: number | null;
	estimatedMargin: number | null;
	commissions: Array<{
		id: string;
		userId: string;
		userName: string;
		type: string;
		recurring: boolean;
		percentage: number | null;
		fixedAmountCents: number | null;
		currency: string;
		active: boolean;
	}>;
};

type ProfileWithCommissions = Prisma.ClientFinancialProfileGetPayload<{
	include: {
		commissions: { include: { user: { select: { id: true; name: true } } } };
	};
}>;

function startOfWeek(value: Date): Date {
	const date = new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
	);
	const day = date.getUTCDay();
	const offset = day === 0 ? -6 : 1 - day;
	date.setUTCDate(date.getUTCDate() + offset);
	return date;
}

function endOfWeek(value: Date): Date {
	const end = startOfWeek(value);
	end.setUTCDate(end.getUTCDate() + 7);
	return end;
}

function startOfMonth(value: Date): Date {
	return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function decimal(value: unknown): Prisma.Decimal | null {
	return value === null || value === undefined
		? null
		: new Prisma.Decimal(value as string | number);
}

function sum(values: Array<Prisma.Decimal | null | undefined>): Prisma.Decimal {
	return values.reduce<Prisma.Decimal>(
		(total, value) => total.plus(value ?? 0),
		new Prisma.Decimal(0),
	);
}

function percent(
	value: Prisma.Decimal | null,
	base: Prisma.Decimal | null,
): Prisma.Decimal {
	if (!value || !base) return new Prisma.Decimal(0);
	return base.times(value).dividedBy(100);
}

function payloadDecimal(payload: Prisma.JsonValue | null, key: string) {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return null;
	const value = payload[key];
	return typeof value === "string" || typeof value === "number"
		? new Prisma.Decimal(value)
		: null;
}

function serializeMilestones(value: Prisma.JsonValue) {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(entry): entry is { date: string; targetAmountCents: number } =>
			typeof entry === "object" &&
			entry !== null &&
			!Array.isArray(entry) &&
			typeof entry.date === "string" &&
			typeof entry.targetAmountCents === "number",
	);
}

function serializeWeeklyTarget(
	row: {
		id: string;
		userId: string;
		weekStart: Date;
		outreachContacts: number;
		followUps: number;
		qualifiedOpportunities: number;
		proposals: number;
		clientsClosed: number;
		mrrGeneratedTargetBase: Prisma.Decimal | null;
	} | null,
) {
	if (!row) return null;
	return {
		id: row.id,
		userId: row.userId,
		weekStart: row.weekStart.toISOString(),
		outreachContacts: row.outreachContacts,
		followUps: row.followUps,
		qualifiedOpportunities: row.qualifiedOpportunities,
		proposals: row.proposals,
		clientsClosed: row.clientsClosed,
		mrrGeneratedTargetCents: toCents(row.mrrGeneratedTargetBase),
	};
}

@Injectable()
export class FinanceService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly conversion: ConversionService,
		private readonly permissions: PermissionAccessService,
	) {}

	async commandCenter(
		userId: string,
		role: "admin" | "team" | "contributor",
		input: FinanceDashboardInput,
	) {
		const base = await this.conversion.reportingCurrency();
		const ownerFilter =
			input.scope === "me"
				? {
						OR: [
							{ deal: { ownerId: userId } },
							{ company: { ownerId: userId } },
							{ contact: { ownerId: userId } },
						],
					}
				: {};
		const canMrr = await this.permissions.can(
			userId,
			role,
			"finance.company.mrr",
		);
		const canRevenue = await this.permissions.can(
			userId,
			role,
			"finance.company.revenue",
		);
		const canProfit = await this.permissions.can(
			userId,
			role,
			"finance.company.profit",
		);
		const canCosts = await this.permissions.can(
			userId,
			role,
			"finance.company.costs",
		);
		const canPipeline = await this.permissions.can(
			userId,
			role,
			"finance.pipeline.value",
		);
		const canGoals = await this.permissions.can(
			userId,
			role,
			"finance.goals.read",
		);
		const canTeam = await this.permissions.can(
			userId,
			role,
			"finance.team.performance.all",
		);
		const canOwnTeam = await this.permissions.can(
			userId,
			role,
			"finance.team.performance.own",
		);

		const profileWhere = {
			billingStatus: "ACTIVE" as const,
			lifecycleState: "ACTIVE" as const,
			baseCurrency: base,
			...ownerFilter,
		};
		const profiles = await this.db.clientFinancialProfile.findMany({
			where: profileWhere,
			select: {
				id: true,
				monthlyFeeBase: true,
				onboardingFeeBase: true,
				directMonthlyCostBase: true,
				editorMonthlyCostBase: true,
				otherRecurringCostBase: true,
				oneOffRevenueBase: true,
				additionalChargesBase: true,
				outstandingAmountBase: true,
				deal: { select: { ownerId: true } },
				commissions: {
					where: { active: true, recurring: true },
					select: { type: true, percentage: true, fixedAmountBase: true },
				},
			},
		});
		const monthStart = startOfMonth(new Date());
		const events = canMrr
			? await this.db.financialEvent.findMany({
					where: {
						lifecycleState: "ACTIVE",
						occurredAt: { gte: monthStart },
						financialProfile: {
							lifecycleState: "ACTIVE",
							baseCurrency: base,
							...ownerFilter,
						},
					},
					select: { payload: true },
				})
			: [];
		const newMrr = sum(
			events.map((event) => payloadDecimal(event.payload, "newMrrBase")),
		);
		const lostMrr = sum(
			events.map((event) => payloadDecimal(event.payload, "lostMrrBase")),
		);

		const now = new Date();
		const expenses = await this.db.companyExpense.findMany({
			where: {
				active: true,
				baseCurrency: base,
				OR: [
					{
						recurringMonthly: true,
						startDate: { lte: now },
						OR: [{ endDate: null }, { endDate: { gte: now } }],
					},
					{
						recurringMonthly: false,
						startDate: {
							gte: startOfMonth(now),
							lt: new Date(
								Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
							),
						},
					},
				],
			},
			select: { baseAmount: true, recurringMonthly: true },
		});
		const operatingCosts = sum(expenses.map((expense) => expense.baseAmount));
		const totals = calculateFinancialTotals(profiles, operatingCosts);
		const {
			mrr,
			directClientCosts: directCosts,
			outstanding,
			revenue,
			profit,
		} = totals;

		const pipeline: {
			totalMrrCents: number | null;
			weightedMrrCents: number | null;
			forecastedMrrCents: number | null;
			totalOneOffCents: number | null;
			openDeals: number;
			warmOpportunities: number;
		} = canPipeline
			? await this.pipeline(userId, input.scope, base)
			: {
					totalMrrCents: null,
					weightedMrrCents: null,
					forecastedMrrCents: null,
					totalOneOffCents: null,
					openDeals: 0,
					warmOpportunities: 0,
				};
		if (canPipeline && canMrr && pipeline.weightedMrrCents !== null) {
			pipeline.forecastedMrrCents =
				(toCents(mrr) ?? 0) + pipeline.weightedMrrCents;
		}
		const goal = canGoals ? await this.currentGoal(base, mrr, canMrr) : null;
		const team = canTeam
			? await this.teamPerformance(userId, base, false)
			: canOwnTeam
				? await this.teamPerformance(userId, base, true)
				: [];
		if (input.scope === "everyone")
			await this.recordCompanySnapshot({
				periodStart: monthStart,
				currency: base,
				totals,
				newMrr,
				lostMrr,
				activeClients: profiles.length,
			});

		return {
			reportingCurrency: base,
			scope: input.scope,
			financial: {
				currentMrrCents: canMrr ? (toCents(mrr) ?? 0) : null,
				monthlyRevenueCents: canRevenue ? (toCents(revenue) ?? 0) : null,
				directClientCostsCents: canCosts ? (toCents(directCosts) ?? 0) : null,
				operatingCostsCents: canCosts ? (toCents(operatingCosts) ?? 0) : null,
				estimatedProfitCents: canProfit ? (toCents(profit) ?? 0) : null,
				estimatedMargin: canProfit ? margin(profit, revenue) : null,
				newMrrCents: canMrr ? (toCents(newMrr) ?? 0) : null,
				lostMrrCents: canMrr ? (toCents(lostMrr) ?? 0) : null,
				activeClients: canMrr ? profiles.length : null,
				outstandingCents: canRevenue ? (toCents(outstanding) ?? 0) : null,
			},
			pipeline,
			goal,
			team,
			permissions: {
				canMrr,
				canRevenue,
				canProfit,
				canCosts,
				canPipeline,
				canGoals,
				canTeam: canTeam || canOwnTeam,
			},
		};
	}

	private async pipeline(
		userId: string,
		scope: "me" | "everyone",
		base: string,
	) {
		const deals = await this.db.deal.findMany({
			where: {
				stage: { in: [...OPEN_DEAL_STAGES] },
				lifecycleState: "ACTIVE",
				...(scope === "me" ? { ownerId: userId } : {}),
			},
			select: {
				potentialMonthlyRevenueBase: true,
				potentialOneOffRevenueBase: true,
				potentialBaseCurrency: true,
				pipelineStage: { select: { probability: true } },
			},
		});
		const totals = pipelineTotals(
			deals
				.filter((deal) => deal.potentialBaseCurrency === base)
				.map((deal) => ({
					potentialMonthlyRevenueBase: deal.potentialMonthlyRevenueBase,
					potentialOneOffRevenueBase: deal.potentialOneOffRevenueBase,
					probability: deal.pipelineStage?.probability ?? 0,
				})),
		);
		return {
			totalMrrCents: toCents(totals.totalMrr) ?? 0,
			weightedMrrCents: toCents(totals.weightedMrr) ?? 0,
			forecastedMrrCents: null,
			totalOneOffCents: toCents(totals.totalOneOff) ?? 0,
			openDeals: deals.length,
			warmOpportunities: totals.warmOpportunities,
		};
	}

	private async currentGoal(
		base: string,
		mrr: Prisma.Decimal,
		canMrr: boolean,
	) {
		const goal = await this.db.companyGoal.findFirst({
			where: { type: "MRR", active: true, currency: base },
			orderBy: { deadline: "asc" },
		});
		if (!goal) return null;
		const pace = goalProgress(
			goal.targetAmountBase,
			mrr,
			goal.createdAt,
			goal.deadline,
		);
		return {
			id: goal.id,
			name: goal.name,
			targetCents: toCents(goal.targetAmountBase) ?? 0,
			currentCents: canMrr ? (toCents(mrr) ?? 0) : null,
			remainingCents: canMrr ? (toCents(pace.remaining) ?? 0) : null,
			progress: canMrr ? pace.progress : null,
			deadline: goal.deadline.toISOString(),
			requiredPaceCents: canMrr ? (toCents(pace.requiredPace) ?? 0) : null,
			status: canMrr ? pace.status : "restricted",
			milestones: serializeMilestones(goal.milestones),
		};
	}

	async profile(
		userId: string,
		role: "admin" | "team" | "contributor",
		input: FinancialProfileByRecordInput | { id: string },
	) {
		const row =
			"id" in input
				? await this.db.clientFinancialProfile.findUnique({
						where: { id: input.id },
						include: {
							commissions: {
								include: { user: { select: { id: true, name: true } } },
							},
						},
					})
				: await this.db.clientFinancialProfile.findFirst({
						where: {
							lifecycleState: "ACTIVE",
							OR: [
								input.dealId ? { dealId: input.dealId } : undefined,
								input.companyId ? { companyId: input.companyId } : undefined,
								input.contactId ? { contactId: input.contactId } : undefined,
							].filter(
								(
									value,
								): value is
									| { dealId: string }
									| { companyId: string }
									| { contactId: string } => value !== undefined,
							),
						},
						include: {
							commissions: {
								include: { user: { select: { id: true, name: true } } },
							},
						},
					});
		if (!row) return null;
		const canPricing = await this.permissions.can(
			userId,
			role,
			"finance.client.pricing",
		);
		const canCosts = await this.permissions.can(
			userId,
			role,
			"finance.client.costs",
		);
		const canOwnComp = await this.permissions.can(
			userId,
			role,
			"finance.compensation.own",
		);
		const canOtherComp = await this.permissions.can(
			userId,
			role,
			"finance.compensation.other",
		);
		if (!canPricing && !canCosts && !canOwnComp && !canOtherComp) return null;
		return this.serializeProfile(row, {
			canPricing,
			canCosts,
			canOwnComp,
			canOtherComp,
			userId,
		});
	}

	async profiles(
		userId: string,
		role: "admin" | "team" | "contributor",
		input: FinancialProfilesByRecordInput,
	) {
		const rows = await this.db.clientFinancialProfile.findMany({
			where: {
				lifecycleState: "ACTIVE",
				OR: [
					input.dealId ? { dealId: input.dealId } : undefined,
					input.companyId ? { companyId: input.companyId } : undefined,
					input.contactId ? { contactId: input.contactId } : undefined,
				].filter(
					(
						value,
					): value is
						| { dealId: string }
						| { companyId: string }
						| { contactId: string } => value !== undefined,
				),
			},
			include: {
				commissions: {
					include: { user: { select: { id: true, name: true } } },
				},
			},
		});
		if (!rows.length) return [];
		const canPricing = await this.permissions.can(
			userId,
			role,
			"finance.client.pricing",
		);
		const canCosts = await this.permissions.can(
			userId,
			role,
			"finance.client.costs",
		);
		const canOwnComp = await this.permissions.can(
			userId,
			role,
			"finance.compensation.own",
		);
		const canOtherComp = await this.permissions.can(
			userId,
			role,
			"finance.compensation.other",
		);
		if (!canPricing && !canCosts && !canOwnComp && !canOtherComp) return [];
		return rows.map((row) =>
			this.serializeProfile(row, {
				canPricing,
				canCosts,
				canOwnComp,
				canOtherComp,
				userId,
			}),
		);
	}

	async history(
		userId: string,
		role: "admin" | "team" | "contributor",
		input: FinancialHistoryInput,
	) {
		const row = await this.db.clientFinancialProfile.findUnique({
			where: { id: input.financialProfileId },
			include: {
				snapshots: { orderBy: { periodStart: "desc" } },
				events: {
					orderBy: { occurredAt: "desc" },
					include: { actor: { select: { name: true } } },
				},
			},
		});
		if (!row) return null;
		const canPricing = await this.permissions.can(
			userId,
			role,
			"finance.client.pricing",
		);
		const canCosts = await this.permissions.can(
			userId,
			role,
			"finance.client.costs",
		);
		if (!canPricing && !canCosts) return null;
		const safePayload = (payload: Prisma.JsonValue | null) => {
			if (
				canPricing ||
				!payload ||
				typeof payload !== "object" ||
				Array.isArray(payload)
			)
				return payload;
			return Object.fromEntries(
				Object.entries(payload).filter(
					([key]) => !/(fee|revenue|amount|cost|profit|margin)/i.test(key),
				),
			);
		};
		return {
			snapshots: row.snapshots.map((snapshot) => ({
				id: snapshot.id,
				periodStart: snapshot.periodStart.toISOString(),
				currency: snapshot.currency,
				recurringRevenueCents: canPricing
					? toCents(snapshot.recurringRevenueBase)
					: null,
				oneOffRevenueCents: canPricing
					? toCents(snapshot.oneOffRevenueBase)
					: null,
				directCostCents: canCosts ? toCents(snapshot.directCostBase) : null,
				commissionCents: canCosts ? toCents(snapshot.commissionBase) : null,
				estimatedProfitCents:
					canPricing && canCosts ? toCents(snapshot.estimatedProfitBase) : null,
				margin:
					canPricing && canCosts ? (snapshot.margin?.toNumber() ?? null) : null,
			})),
			events: row.events.map((event) => ({
				id: event.id,
				type: event.type,
				occurredAt: event.occurredAt.toISOString(),
				actorName: event.actor?.name ?? null,
				payload: safePayload(event.payload),
			})),
		};
	}

	async companyHistory(
		userId: string,
		role: "admin" | "team" | "contributor",
		input: CompanyHistoryInput,
	) {
		const base = await this.conversion.reportingCurrency();
		const [canMrr, canRevenue, canProfit, canCosts] = await Promise.all([
			this.permissions.can(userId, role, "finance.company.mrr"),
			this.permissions.can(userId, role, "finance.company.revenue"),
			this.permissions.can(userId, role, "finance.company.profit"),
			this.permissions.can(userId, role, "finance.company.costs"),
		]);
		if (!canMrr && !canRevenue && !canProfit && !canCosts) return null;
		const rows = await this.db.companyFinancialSnapshot.findMany({
			where: {
				lifecycleState: "ACTIVE",
				currency: base,
				...(input.from || input.to
					? {
							periodStart: {
								...(input.from ? { gte: new Date(input.from) } : {}),
								...(input.to ? { lte: new Date(input.to) } : {}),
							},
						}
					: {}),
			},
			orderBy: { periodStart: "desc" },
		});
		return rows.map((row) => ({
			periodStart: row.periodStart.toISOString(),
			currency: row.currency,
			currentMrrCents: canMrr ? toCents(row.recurringRevenueBase) : null,
			newMrrCents: canMrr ? toCents(row.newMrrBase) : null,
			lostMrrCents: canMrr ? toCents(row.lostMrrBase) : null,
			activeClients: canMrr ? row.activeClients : null,
			monthlyRevenueCents: canRevenue ? toCents(row.revenueBase) : null,
			outstandingCents: canRevenue ? toCents(row.outstandingBase) : null,
			directClientCostsCents: canCosts
				? toCents(row.directClientCostBase)
				: null,
			operatingCostsCents: canCosts ? toCents(row.operatingCostBase) : null,
			commissionCents: canCosts ? toCents(row.commissionBase) : null,
			estimatedProfitCents: canProfit ? toCents(row.estimatedProfitBase) : null,
			estimatedMargin: canProfit ? (row.margin?.toNumber() ?? null) : null,
		}));
	}

	private serializeProfile(
		row: ProfileWithCommissions,
		access: {
			canPricing: boolean;
			canCosts: boolean;
			canOwnComp: boolean;
			canOtherComp: boolean;
			userId: string;
		},
	): FinancialProfileView {
		const costFields: MoneyField[] = [
			"directMonthlyCost",
			"editorMonthlyCost",
			"otherRecurringCost",
		];
		const visible = (field: MoneyField) =>
			costFields.includes(field) ? access.canCosts : access.canPricing;
		const profile = {
			id: row.id,
			dealId: row.dealId,
			companyId: row.companyId,
			contactId: row.contactId,
			packageName: row.packageName,
			currency: row.currency,
			billingStatus: row.billingStatus,
			paymentStatus: row.paymentStatus,
			contractStartDate: row.contractStartDate?.toISOString() ?? null,
			contractEndDate: row.contractEndDate?.toISOString() ?? null,
			estimatedMonthlyProfitCents: null,
			estimatedMargin: null,
		} as FinancialProfileView;
		for (const field of MONEY_FIELDS)
			profile[`${field}Cents`] = visible(field) ? toCents(row[field]) : null;
		const monthly = decimal(row.monthlyFeeBase) ?? new Prisma.Decimal(0);
		const costs = sum([
			row.directMonthlyCostBase,
			row.editorMonthlyCostBase,
			row.otherRecurringCostBase,
		]);
		const commission = sum(
			row.commissions
				.filter((item) => item.active && item.recurring)
				.map((item) =>
					item.type === "PERCENTAGE"
						? percent(decimal(item.percentage), monthly)
						: decimal(item.fixedAmountBase),
				),
		);
		const profit = monthly.minus(costs).minus(commission);
		if (access.canPricing && access.canCosts) {
			profile.estimatedMonthlyProfitCents = toCents(profit);
			profile.estimatedMargin = monthly.isZero()
				? null
				: profit.dividedBy(monthly).toNumber();
		}
		profile.commissions = row.commissions
			.filter((item) =>
				item.userId === access.userId ? access.canOwnComp : access.canOtherComp,
			)
			.map((item) => ({
				id: item.id,
				userId: item.userId,
				userName: item.user.name,
				type: item.type,
				recurring: item.recurring,
				percentage: item.percentage?.toNumber?.() ?? null,
				fixedAmountCents: item.fixedAmount ? toCents(item.fixedAmount) : null,
				currency: item.currency,
				active: item.active,
			}));
		return profile;
	}

	async upsertProfile(actorUserId: string, input: FinancialProfileUpsertInput) {
		const linkedRecordFilters = [
			input.dealId ? { dealId: input.dealId } : undefined,
			input.companyId ? { companyId: input.companyId } : undefined,
			input.contactId ? { contactId: input.contactId } : undefined,
		].filter(
			(
				value,
			): value is
				| { dealId: string }
				| { companyId: string }
				| { contactId: string } => value !== undefined,
		);
		const existing = input.id
			? await this.db.clientFinancialProfile.findUnique({
					where: { id: input.id },
				})
			: linkedRecordFilters.length
				? await this.db.clientFinancialProfile.findFirst({
						where: { OR: linkedRecordFilters },
					})
				: null;
		const currency =
			input.currency ??
			existing?.currency ??
			(await this.conversion.reportingCurrency());
		const reportingCurrency = await this.conversion.reportingCurrency();
		const rate =
			existing?.currency === currency &&
			existing.baseCurrency === reportingCurrency &&
			existing.fxRate
				? {
						rate: existing.fxRate,
						asOf: existing.fxRateAt ?? existing.updatedAt,
						origin: "MANUAL" as const,
						provider: null,
					}
				: await this.conversion.rateFor(currency);
		const baseCurrency = rate ? reportingCurrency : null;
		const values = Object.fromEntries(
			MONEY_FIELDS.map((field) => [
				field,
				input[`${field}Cents` as keyof FinancialProfileUpsertInput] ===
				undefined
					? (existing?.[field] ?? null)
					: decimalFromCents(
							input[`${field}Cents` as keyof FinancialProfileUpsertInput] as
								| number
								| null
								| undefined,
						),
			]),
		) as Record<MoneyField, Prisma.Decimal | null>;
		if ((input.paymentStatus ?? existing?.paymentStatus) === "PAID") {
			values.outstandingAmount = new Prisma.Decimal(0);
		}
		const bases = Object.fromEntries(
			MONEY_FIELDS.map((field) => [
				BASE_FIELDS[field],
				values[field] && rate && baseCurrency
					? applyRate(values[field], rate, baseCurrency).baseAmount
					: null,
			]),
		);
		const data = {
			...(input.dealId === undefined ? {} : { dealId: input.dealId }),
			...(input.companyId === undefined ? {} : { companyId: input.companyId }),
			...(input.contactId === undefined ? {} : { contactId: input.contactId }),
			packageName:
				input.packageName === undefined
					? (existing?.packageName ?? null)
					: input.packageName,
			currency,
			baseCurrency,
			fxRate: rate?.rate ?? null,
			fxRateAt: rate?.asOf ?? null,
			...values,
			...bases,
			...(input.contractStartDate === undefined
				? {}
				: {
						contractStartDate: input.contractStartDate
							? new Date(input.contractStartDate)
							: null,
					}),
			...(input.contractEndDate === undefined
				? {}
				: {
						contractEndDate: input.contractEndDate
							? new Date(input.contractEndDate)
							: null,
					}),
			...(input.billingStatus === undefined
				? {}
				: { billingStatus: input.billingStatus }),
			...(input.paymentStatus === undefined
				? {}
				: { paymentStatus: input.paymentStatus }),
		};
		return this.db.$transaction(async (tx) => {
			const row = existing
				? await tx.clientFinancialProfile.update({
						where: { id: existing.id },
						data,
					})
				: await tx.clientFinancialProfile.create({
						data: {
							...data,
							dealId: data.dealId ?? null,
							companyId: data.companyId ?? null,
							contactId: data.contactId ?? null,
						},
					});
			const movement = mrrMovement(
				existing?.billingStatus ?? null,
				existing?.monthlyFeeBase ?? null,
				row.billingStatus,
				row.monthlyFeeBase,
			);
			const oldMrr =
				existing?.billingStatus === "ACTIVE"
					? (existing.monthlyFeeBase ?? new Prisma.Decimal(0))
					: new Prisma.Decimal(0);
			const feeChanged =
				existing?.monthlyFee?.toString() !== row.monthlyFee?.toString();
			const statusChanged = existing?.billingStatus !== row.billingStatus;
			const paymentChanged = existing?.paymentStatus !== row.paymentStatus;
			const eventType = !existing
				? "PROFILE_CREATED"
				: statusChanged
					? row.billingStatus === "ENDED"
						? "CHURNED"
						: "STATUS_CHANGED"
					: paymentChanged
						? "PAYMENT_STATUS_CHANGED"
						: feeChanged
							? "FEE_CHANGED"
							: "PROFILE_UPDATED";
			await tx.financialEvent.create({
				data: {
					financialProfileId: row.id,
					actorUserId,
					type: eventType,
					payload: {
						currency,
						billingStatus: row.billingStatus,
						monthlyFeeCents: toCents(row.monthlyFee),
						oldMrrBase: oldMrr.toString(),
						newMrrBase: movement.newMrr.isZero()
							? null
							: movement.newMrr.toString(),
						lostMrrBase: movement.lostMrr.isZero()
							? null
							: movement.lostMrr.toString(),
						oldOutstandingBase:
							existing?.outstandingAmountBase?.toString() ?? null,
						newOutstandingBase: row.outstandingAmountBase?.toString() ?? null,
					},
				},
			});
			const periodStart = startOfMonth(new Date());
			const directCostBase = sum([
				row.directMonthlyCostBase,
				row.editorMonthlyCostBase,
				row.otherRecurringCostBase,
			]);
			const commissionRows = await tx.clientCommission.findMany({
				where: { financialProfileId: row.id, active: true, recurring: true },
				select: { type: true, percentage: true, fixedAmountBase: true },
			});
			const commissionBase = sum(
				commissionRows.map((commission) =>
					commission.type === "PERCENTAGE"
						? (row.monthlyFeeBase ?? new Prisma.Decimal(0))
								.mul(commission.percentage ?? 0)
								.div(100)
						: commission.fixedAmountBase,
				),
			);
			const estimatedProfitBase = sum([
				row.monthlyFeeBase,
				row.onboardingFeeBase,
				row.oneOffRevenueBase,
				row.additionalChargesBase,
			])
				.minus(directCostBase)
				.minus(commissionBase);
			const estimatedMargin =
				row.monthlyFeeBase && !row.monthlyFeeBase.isZero()
					? estimatedProfitBase.dividedBy(row.monthlyFeeBase)
					: null;
			await tx.financialSnapshot.upsert({
				where: {
					financialProfileId_periodStart: {
						financialProfileId: row.id,
						periodStart,
					},
				},
				create: {
					financialProfileId: row.id,
					periodStart,
					currency: row.currency,
					recurringRevenueBase: row.monthlyFeeBase,
					oneOffRevenueBase: sum([
						row.onboardingFeeBase,
						row.oneOffRevenueBase,
						row.additionalChargesBase,
					]),
					directCostBase,
					commissionBase,
					estimatedProfitBase,
					margin: estimatedMargin,
					data: { billingStatus: row.billingStatus },
				},
				update: {
					currency: row.currency,
					recurringRevenueBase: row.monthlyFeeBase,
					oneOffRevenueBase: sum([
						row.onboardingFeeBase,
						row.oneOffRevenueBase,
						row.additionalChargesBase,
					]),
					directCostBase,
					commissionBase,
					estimatedProfitBase,
					margin: estimatedMargin,
					data: { billingStatus: row.billingStatus },
				},
			});
			return row;
		});
	}

	async upsertCommission(actorUserId: string, input: CommissionUpsertInput) {
		await this.assertWorkspaceUser(input.userId);
		const existing = input.id
			? await this.db.clientCommission.findUnique({ where: { id: input.id } })
			: null;
		const profile = await this.db.clientFinancialProfile.findUnique({
			where: { id: input.financialProfileId },
			select: { currency: true },
		});
		if (!profile) throw new NotFoundException("Financial profile not found");
		const reportingCurrency = await this.conversion.reportingCurrency();
		const currency = input.currency ?? existing?.currency ?? profile.currency;
		const rate =
			existing?.currency === currency &&
			existing.baseCurrency === reportingCurrency &&
			existing.fxRate
				? {
						rate: existing.fxRate,
						asOf: existing.fxRateAt ?? existing.updatedAt,
						origin: "MANUAL" as const,
						provider: null,
					}
				: await this.conversion.rateFor(currency);
		const fixedAmount =
			input.fixedAmountCents === undefined
				? (existing?.fixedAmount ?? null)
				: decimalFromCents(input.fixedAmountCents);
		const baseCurrency = rate ? reportingCurrency : null;
		const fixedAmountBase =
			fixedAmount && rate
				? applyRate(fixedAmount, rate, baseCurrency as string).baseAmount
				: null;
		const data = {
			financialProfileId: input.financialProfileId,
			userId: input.userId,
			type: input.type,
			recurring: input.recurring,
			percentage: input.percentage,
			fixedAmount,
			fixedAmountBase,
			currency: currency,
			baseCurrency,
			fxRate: rate?.rate ?? null,
			fxRateAt: rate?.asOf ?? null,
			active: input.active,
		};
		return this.db.$transaction(async (tx) => {
			const commission = input.id
				? await tx.clientCommission.update({ where: { id: input.id }, data })
				: await tx.clientCommission.create({ data });
			const profile = await tx.clientFinancialProfile.findUnique({
				where: { id: input.financialProfileId },
			});
			if (!profile) throw new NotFoundException("Financial profile not found");
			const periodStart = startOfMonth(new Date());
			const directCostBase = sum([
				profile.directMonthlyCostBase,
				profile.editorMonthlyCostBase,
				profile.otherRecurringCostBase,
			]);
			const recurringCommissions = await tx.clientCommission.findMany({
				where: {
					financialProfileId: profile.id,
					active: true,
					recurring: true,
				},
				select: { type: true, percentage: true, fixedAmountBase: true },
			});
			const commissionBase = sum(
				recurringCommissions.map((row) =>
					row.type === "PERCENTAGE"
						? percent(profile.monthlyFeeBase, row.percentage)
						: row.fixedAmountBase,
				),
			);
			const estimatedProfitBase = sum([
				profile.monthlyFeeBase,
				profile.onboardingFeeBase,
				profile.oneOffRevenueBase,
				profile.additionalChargesBase,
			])
				.minus(directCostBase)
				.minus(commissionBase);
			const estimatedMargin =
				profile.monthlyFeeBase && !profile.monthlyFeeBase.isZero()
					? margin(estimatedProfitBase, profile.monthlyFeeBase)
					: null;
			await tx.financialSnapshot.upsert({
				where: {
					financialProfileId_periodStart: {
						financialProfileId: profile.id,
						periodStart,
					},
				},
				create: {
					financialProfileId: profile.id,
					periodStart,
					currency: profile.currency,
					recurringRevenueBase: profile.monthlyFeeBase,
					oneOffRevenueBase: sum([
						profile.onboardingFeeBase,
						profile.oneOffRevenueBase,
						profile.additionalChargesBase,
					]),
					directCostBase,
					commissionBase,
					estimatedProfitBase,
					margin: estimatedMargin,
					data: { billingStatus: profile.billingStatus },
				},
				update: {
					currency: profile.currency,
					recurringRevenueBase: profile.monthlyFeeBase,
					oneOffRevenueBase: sum([
						profile.onboardingFeeBase,
						profile.oneOffRevenueBase,
						profile.additionalChargesBase,
					]),
					directCostBase,
					commissionBase,
					estimatedProfitBase,
					margin: estimatedMargin,
					data: { billingStatus: profile.billingStatus },
				},
			});
			await tx.financialEvent.create({
				data: {
					financialProfileId: profile.id,
					actorUserId,
					type: "PROFILE_UPDATED",
					payload: {
						reason: "COMMISSION_UPDATED",
						commissionId: commission.id,
					},
				},
			});
			return commission;
		});
	}

	async expenses(input: ExpenseListInput) {
		const rows = await this.db.companyExpense.findMany({
			where: input.active === undefined ? {} : { active: input.active },
			orderBy: [{ active: "desc" }, { startDate: "desc" }],
		});
		return rows.map((row) => ({
			id: row.id,
			category: row.category,
			amountCents: toCents(row.amount) ?? 0,
			currency: row.currency,
			baseAmountCents: toCents(row.baseAmount),
			recurringMonthly: row.recurringMonthly,
			active: row.active,
			startDate: row.startDate.toISOString(),
			endDate: row.endDate?.toISOString() ?? null,
			description: row.description,
		}));
	}

	async upsertExpense(actorUserId: string, input: ExpenseUpsertInput) {
		const existing = input.id
			? await this.db.companyExpense.findUnique({ where: { id: input.id } })
			: null;
		const reportingCurrency = await this.conversion.reportingCurrency();
		const rate =
			existing?.currency === input.currency &&
			existing.baseCurrency === reportingCurrency &&
			existing.fxRate
				? {
						rate: existing.fxRate,
						asOf: existing.fxRateAt ?? existing.updatedAt,
						origin: "MANUAL" as const,
						provider: null,
					}
				: await this.conversion.rateFor(input.currency);
		const amount = decimalFromCents(input.amountCents) as Prisma.Decimal;
		const baseCurrency = rate ? reportingCurrency : null;
		const data = {
			category: input.category,
			amount,
			currency: input.currency,
			baseAmount: rate
				? applyRate(amount, rate, baseCurrency as string).baseAmount
				: null,
			baseCurrency,
			fxRate: rate?.rate ?? null,
			fxRateAt: rate?.asOf ?? null,
			recurringMonthly: input.recurringMonthly,
			active: input.active,
			startDate: new Date(input.startDate),
			endDate: input.endDate ? new Date(input.endDate) : null,
			description: input.description ?? null,
			createdByUserId: actorUserId,
		};
		if (input.id) {
			const { createdByUserId: _createdByUserId, ...updateData } = data;
			return this.db.companyExpense.update({
				where: { id: input.id },
				data: updateData,
			});
		}
		return this.db.companyExpense.create({ data });
	}

	async goals(base: string, mrr: Prisma.Decimal, canMrr = true) {
		const rows = await this.db.companyGoal.findMany({
			where: { active: true, currency: base },
			orderBy: { deadline: "asc" },
		});
		return rows.map((row) => {
			const pace = goalProgress(
				row.targetAmountBase,
				mrr,
				row.createdAt,
				row.deadline,
			);
			return {
				id: row.id,
				type: row.type,
				name: row.name,
				targetAmountCents: toCents(row.targetAmountBase) ?? 0,
				currency: row.currency,
				deadline: row.deadline.toISOString(),
				milestones: serializeMilestones(row.milestones),
				active: row.active,
				progress: canMrr ? pace.progress : null,
				remainingCents: canMrr ? (toCents(pace.remaining) ?? 0) : null,
				currentCents: canMrr ? (toCents(mrr) ?? 0) : null,
				requiredPaceCents: canMrr ? (toCents(pace.requiredPace) ?? 0) : null,
				status: canMrr ? pace.status : "restricted",
			};
		});
	}

	async goalsForViewer(userId: string, role: "admin" | "team" | "contributor") {
		const base = await this.conversion.reportingCurrency();
		const canMrr = await this.permissions.can(
			userId,
			role,
			"finance.company.mrr",
		);
		const total = await this.db.clientFinancialProfile.aggregate({
			where: {
				billingStatus: "ACTIVE",
				lifecycleState: "ACTIVE",
				baseCurrency: base,
			},
			_sum: { monthlyFeeBase: true },
		});
		return this.goals(
			base,
			total._sum.monthlyFeeBase ?? new Prisma.Decimal(0),
			canMrr,
		);
	}

	async upsertGoal(actorUserId: string, input: GoalInput) {
		const base = await this.conversion.reportingCurrency();
		const data = {
			type: input.type,
			name: input.name,
			targetAmountBase: decimalFromCents(
				input.targetAmountCents,
			) as Prisma.Decimal,
			currency: base,
			deadline: new Date(input.deadline),
			milestones: input.milestones,
			active: input.active,
			createdByUserId: actorUserId,
		};
		if (input.id) {
			const { createdByUserId: _createdByUserId, ...updateData } = data;
			return this.db.companyGoal.update({
				where: { id: input.id },
				data: updateData,
			});
		}
		return this.db.companyGoal.create({ data });
	}

	async weeklyTarget(input: { userId: string; weekStart: Date }) {
		return this.db.weeklyTarget.findUnique({
			where: {
				userId_weekStart: {
					userId: input.userId,
					weekStart: startOfWeek(input.weekStart),
				},
			},
		});
	}

	async upsertWeeklyTarget(input: WeeklyTargetInput) {
		await this.assertWorkspaceUser(input.userId);
		return this.db.weeklyTarget.upsert({
			where: {
				userId_weekStart: {
					userId: input.userId,
					weekStart: startOfWeek(new Date(input.weekStart)),
				},
			},
			create: {
				userId: input.userId,
				weekStart: startOfWeek(new Date(input.weekStart)),
				outreachContacts: input.outreachContacts,
				followUps: input.followUps,
				qualifiedOpportunities: input.qualifiedOpportunities,
				proposals: input.proposals,
				clientsClosed: input.clientsClosed,
				mrrGeneratedTargetBase:
					input.mrrGeneratedTargetCents === null ||
					input.mrrGeneratedTargetCents === undefined
						? null
						: decimalFromCents(input.mrrGeneratedTargetCents),
			},
			update: {
				outreachContacts: input.outreachContacts,
				followUps: input.followUps,
				qualifiedOpportunities: input.qualifiedOpportunities,
				proposals: input.proposals,
				clientsClosed: input.clientsClosed,
				mrrGeneratedTargetBase:
					input.mrrGeneratedTargetCents === null ||
					input.mrrGeneratedTargetCents === undefined
						? null
						: decimalFromCents(input.mrrGeneratedTargetCents),
			},
		});
	}

	async teamPerformance(
		requestingUserId: string,
		base: string,
		ownOnly: boolean,
	) {
		const users = await this.db.user.findMany({
			where: ownOnly
				? { id: requestingUserId }
				: { profile: { status: "ACTIVE" } },
			select: { id: true, name: true, image: true },
			orderBy: { name: "asc" },
		});
		const now = new Date();
		const weekStart = startOfWeek(now);
		const weekEnd = endOfWeek(now);
		return Promise.all(
			users.map(async (user) => {
				const target = serializeWeeklyTarget(
					await this.weeklyTarget({ userId: user.id, weekStart }),
				);
				const [
					outreach,
					followUpsDue,
					followUpsCompleted,
					positiveResponses,
					qualified,
					proposals,
					warmOpportunities,
					closed,
				] = await Promise.all([
					this.db.activity.count({
						where: {
							lifecycleState: "ACTIVE",
							createdById: user.id,
							type: { in: ["EMAIL", "CALL"] },
							createdAt: { gte: weekStart, lt: weekEnd },
						},
					}),
					this.db.operationalTask.count({
						where: {
							assigneeUserId: user.id,
							status: { notIn: ["DONE", "CANCELLED"] },
							dueAt: { gte: weekStart, lt: weekEnd },
						},
					}),
					this.db.operationalTask.count({
						where: {
							assigneeUserId: user.id,
							status: "DONE",
							completedAt: { gte: weekStart, lt: weekEnd },
						},
					}),
					this.db.outboundDelivery.count({
						where: {
							status: "REPLIED",
							updatedAt: { gte: weekStart, lt: weekEnd },
							draft: { ownerUserId: user.id },
						},
					}),
					this.db.lead.count({
						where: {
							ownerUserId: user.id,
							status: "QUALIFIED",
							updatedAt: { gte: weekStart, lt: weekEnd },
						},
					}),
					this.db.proposal.count({
						where: {
							ownerUserId: user.id,
							createdAt: { gte: weekStart, lt: weekEnd },
						},
					}),
					this.db.deal.count({
						where: {
							ownerId: user.id,
							lifecycleState: "ACTIVE",
							stage: { in: [...OPEN_DEAL_STAGES] },
							pipelineStage: { probability: { gte: 50 } },
						},
					}),
					this.db.clientFinancialProfile.findMany({
						where: {
							billingStatus: "ACTIVE",
							lifecycleState: "ACTIVE",
							baseCurrency: base,
							contractStartDate: { gte: weekStart, lt: weekEnd },
							OR: [
								{ deal: { ownerId: user.id } },
								{ company: { ownerId: user.id } },
								{ contact: { ownerId: user.id } },
							],
						},
						select: { monthlyFeeBase: true },
					}),
				]);
				const mrr = sum(closed.map((row) => row.monthlyFeeBase));
				return {
					user,
					weekStart: weekStart.toISOString(),
					target,
					actual: {
						outreachContacts: outreach,
						followUps: followUpsCompleted,
						followUpsDue,
						positiveResponses,
						qualifiedOpportunities: qualified,
						proposals,
						clientsClosed: closed.length,
						warmOpportunities,
						mrrGeneratedCents: toCents(mrr) ?? 0,
					},
				};
			}),
		);
	}

	async performanceForViewer(requestingUserId: string, ownOnly: boolean) {
		return this.teamPerformance(
			requestingUserId,
			await this.conversion.reportingCurrency(),
			ownOnly,
		);
	}

	async permissionOverrides() {
		return this.db.workspacePermissionOverride.findMany({
			include: { user: { select: { id: true, name: true, email: true } } },
			orderBy: [{ permission: "asc" }, { user: { name: "asc" } }],
		});
	}

	async setPermissionOverride(
		actorUserId: string,
		input: PermissionOverrideInput,
	) {
		await this.assertWorkspaceUser(input.userId);
		return this.db.workspacePermissionOverride.upsert({
			where: {
				userId_permission: {
					userId: input.userId,
					permission: input.permission,
				},
			},
			create: {
				userId: input.userId,
				permission: input.permission,
				allowed: input.allowed,
				createdByUserId: actorUserId,
			},
			update: { allowed: input.allowed, createdByUserId: actorUserId },
		});
	}

	private async recordCompanySnapshot(input: {
		periodStart: Date;
		currency: string;
		totals: ReturnType<typeof calculateFinancialTotals>;
		newMrr: Prisma.Decimal;
		lostMrr: Prisma.Decimal;
		activeClients: number;
	}) {
		await this.db.companyFinancialSnapshot.upsert({
			where: {
				currency_periodStart: {
					currency: input.currency,
					periodStart: input.periodStart,
				},
			},
			create: {
				periodStart: input.periodStart,
				currency: input.currency,
				lifecycleState: "ACTIVE",
				recurringRevenueBase: input.totals.mrr,
				oneOffRevenueBase: input.totals.oneOffRevenue,
				revenueBase: input.totals.revenue,
				directClientCostBase: input.totals.directClientCosts,
				commissionBase: input.totals.commissions,
				operatingCostBase: input.totals.operatingCosts,
				estimatedProfitBase: input.totals.profit,
				margin: input.totals.margin,
				outstandingBase: input.totals.outstanding,
				newMrrBase: input.newMrr.isZero() ? null : input.newMrr,
				lostMrrBase: input.lostMrr.isZero() ? null : input.lostMrr,
				activeClients: input.activeClients,
				data: { capturedAt: new Date().toISOString() },
			},
			update: {
				recurringRevenueBase: input.totals.mrr,
				oneOffRevenueBase: input.totals.oneOffRevenue,
				revenueBase: input.totals.revenue,
				directClientCostBase: input.totals.directClientCosts,
				commissionBase: input.totals.commissions,
				operatingCostBase: input.totals.operatingCosts,
				estimatedProfitBase: input.totals.profit,
				margin: input.totals.margin,
				outstandingBase: input.totals.outstanding,
				newMrrBase: input.newMrr.isZero() ? null : input.newMrr,
				lostMrrBase: input.lostMrr.isZero() ? null : input.lostMrr,
				activeClients: input.activeClients,
				data: { capturedAt: new Date().toISOString() },
			},
		});
	}

	private async assertWorkspaceUser(userId: string) {
		const member = await this.db.member.findUnique({
			where: {
				organizationId_userId: { organizationId: WORKSPACE_ID, userId },
			},
			select: { userId: true },
		});
		if (!member)
			throw new NotFoundException("That user is not in this workspace.");
	}
}
