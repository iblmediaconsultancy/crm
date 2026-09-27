import { FINANCE_PERMISSIONS } from "@crm/auth";
import { z } from "zod";
import { currencyCode } from "../currency/currency.contracts";

const id = z.string().trim().min(1).max(191);
const cents = z
	.number()
	.int()
	.min(0)
	.max(99_999_999_999_999)
	.nullable()
	.optional();
const signedCents = z
	.number()
	.int()
	.min(-99_999_999_999_999)
	.max(99_999_999_999_999)
	.nullable()
	.optional();
const date = z.string().datetime();

export const financeDashboardInput = z.object({
	scope: z.enum(["me", "everyone"]).default("everyone"),
});

export const financialProfileByRecordInput = z
	.object({
		dealId: id.optional(),
		companyId: id.optional(),
		contactId: id.optional(),
	})
	.refine(
		(value) => Boolean(value.dealId || value.companyId || value.contactId),
		"Choose a CRM record.",
	);

export const financialProfilesByRecordInput = financialProfileByRecordInput;

export const financialHistoryInput = z.object({ financialProfileId: id });

export const companyHistoryInput = z.object({
	from: date.optional(),
	to: date.optional(),
});

export const financialProfileUpsertInput = z
	.object({
		id: id.optional(),
		dealId: id.nullable().optional(),
		companyId: id.nullable().optional(),
		contactId: id.nullable().optional(),
		packageName: z.string().trim().max(160).nullable().optional(),
		currency: currencyCode.optional(),
		contractStartDate: date.nullable().optional(),
		contractEndDate: date.nullable().optional(),
		billingStatus: z
			.enum(["NOT_STARTED", "ACTIVE", "PAUSED", "ENDED"])
			.optional(),
		paymentStatus: z
			.enum(["NOT_APPLICABLE", "CURRENT", "PENDING", "OVERDUE", "PAID"])
			.optional(),
		monthlyFeeCents: cents,
		directMonthlyCostCents: cents,
		editorMonthlyCostCents: cents,
		otherRecurringCostCents: cents,
		onboardingFeeCents: signedCents,
		oneOffRevenueCents: signedCents,
		additionalChargesCents: signedCents,
		outstandingAmountCents: cents,
	})
	.refine(
		(value) =>
			Boolean(value.id || value.dealId || value.companyId || value.contactId),
		"Link the financial profile to a CRM record.",
	);

export const commissionUpsertInput = z
	.object({
		id: id.optional(),
		financialProfileId: id,
		userId: id,
		type: z.enum(["PERCENTAGE", "FIXED"]),
		recurring: z.boolean().default(true),
		percentage: z.number().min(0).max(100).nullable().optional(),
		fixedAmountCents: cents,
		currency: currencyCode.optional(),
		active: z.boolean().default(true),
	})
	.refine(
		(value) =>
			value.type === "PERCENTAGE"
				? value.percentage !== null && value.percentage !== undefined
				: value.fixedAmountCents !== null &&
					value.fixedAmountCents !== undefined,
		"Provide a percentage for percentage commissions or an amount for fixed commissions.",
	);

export const expenseListInput = z.object({
	active: z.boolean().optional(),
});

export const expenseUpsertInput = z.object({
	id: id.optional(),
	category: z.string().trim().min(1).max(100),
	amountCents: z.number().int().min(0).max(99_999_999_999_999),
	currency: currencyCode,
	recurringMonthly: z.boolean().default(true),
	active: z.boolean().default(true),
	startDate: date,
	endDate: date.nullable().optional(),
	description: z.string().trim().max(1000).nullable().optional(),
});

export const goalInput = z.object({
	id: id.optional(),
	type: z.literal("MRR").default("MRR"),
	name: z.string().trim().min(1).max(160),
	targetAmountCents: z.number().int().min(0).max(99_999_999_999_999),
	deadline: date,
	milestones: z
		.array(z.object({ date, targetAmountCents: z.number().int().min(0) }))
		.max(36)
		.default([]),
	active: z.boolean().default(true),
});

export const weeklyTargetInput = z.object({
	userId: id,
	weekStart: date,
	outreachContacts: z.number().int().min(0).max(10000).default(0),
	followUps: z.number().int().min(0).max(10000).default(0),
	qualifiedOpportunities: z.number().int().min(0).max(10000).default(0),
	proposals: z.number().int().min(0).max(10000).default(0),
	clientsClosed: z.number().int().min(0).max(10000).default(0),
	mrrGeneratedTargetCents: z
		.number()
		.int()
		.min(0)
		.max(99_999_999_999_999)
		.nullable()
		.optional(),
});

export const permissionOverrideInput = z.object({
	userId: id,
	permission: z.enum(FINANCE_PERMISSIONS),
	allowed: z.boolean(),
});

export type FinanceDashboardInput = z.infer<typeof financeDashboardInput>;
export type FinancialProfileByRecordInput = z.infer<
	typeof financialProfileByRecordInput
>;
export type FinancialProfilesByRecordInput = z.infer<
	typeof financialProfilesByRecordInput
>;
export type FinancialHistoryInput = z.infer<typeof financialHistoryInput>;
export type CompanyHistoryInput = z.infer<typeof companyHistoryInput>;
export type FinancialProfileUpsertInput = z.infer<
	typeof financialProfileUpsertInput
>;
export type CommissionUpsertInput = z.infer<typeof commissionUpsertInput>;
export type ExpenseListInput = z.infer<typeof expenseListInput>;
export type ExpenseUpsertInput = z.infer<typeof expenseUpsertInput>;
export type GoalInput = z.infer<typeof goalInput>;
export type WeeklyTargetInput = z.infer<typeof weeklyTargetInput>;
export type PermissionOverrideInput = z.infer<typeof permissionOverrideInput>;
