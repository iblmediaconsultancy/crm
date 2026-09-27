import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { PermissionMiddleware } from "../trpc/middlewares/permission.middleware";
import {
	commissionUpsertInput,
	companyHistoryInput,
	expenseListInput,
	expenseUpsertInput,
	financeDashboardInput,
	financialHistoryInput,
	financialProfileByRecordInput,
	financialProfilesByRecordInput,
	financialProfileUpsertInput,
	goalInput,
	permissionOverrideInput,
	weeklyTargetInput,
} from "./finance.contracts";
import { FinanceService } from "./finance.service";

@Router({ alias: "finance" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class FinanceRouter {
	constructor(
		@Inject(FinanceService) private readonly finance: FinanceService,
	) {}

	@Query({ input: financeDashboardInput, meta: { permission: "crm.read" } })
	commandCenter(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof financeDashboardInput>,
	) {
		return this.finance.commandCenter(ctx.user.id, ctx.workspaceRole, input);
	}

	@Query({
		input: financialProfileByRecordInput,
		meta: { permission: "crm.read" },
	})
	profile(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof financialProfileByRecordInput>,
	) {
		return this.finance.profile(ctx.user.id, ctx.workspaceRole, input);
	}

	@Query({
		input: financialProfilesByRecordInput,
		meta: { permission: "crm.read" },
	})
	profiles(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof financialProfilesByRecordInput>,
	) {
		return this.finance.profiles(ctx.user.id, ctx.workspaceRole, input);
	}

	@Query({ input: financialHistoryInput, meta: { permission: "crm.read" } })
	history(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof financialHistoryInput>,
	) {
		return this.finance.history(ctx.user.id, ctx.workspaceRole, input);
	}

	@Query({ input: companyHistoryInput, meta: { permission: "crm.read" } })
	companyHistory(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof companyHistoryInput>,
	) {
		return this.finance.companyHistory(ctx.user.id, ctx.workspaceRole, input);
	}

	@Mutation({
		input: financialProfileUpsertInput,
		meta: { permission: "finance.edit" },
	})
	upsertProfile(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof financialProfileUpsertInput>,
	) {
		return this.finance.upsertProfile(ctx.user.id, input);
	}

	@Mutation({
		input: commissionUpsertInput,
		meta: { permission: "finance.edit" },
	})
	upsertCommission(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof commissionUpsertInput>,
	) {
		return this.finance.upsertCommission(ctx.user.id, input);
	}

	@Query({
		input: expenseListInput,
		meta: { permission: "finance.company.costs" },
	})
	expenses(@Input() input: z.infer<typeof expenseListInput>) {
		return this.finance.expenses(input);
	}

	@Mutation({
		input: expenseUpsertInput,
		meta: { permission: "finance.expenses.edit" },
	})
	upsertExpense(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof expenseUpsertInput>,
	) {
		return this.finance.upsertExpense(ctx.user.id, input);
	}

	@Query({ meta: { permission: "finance.goals.read" } })
	goals(@Ctx() ctx: AuthedTrpcContext) {
		return this.finance.goalsForViewer(ctx.user.id, ctx.workspaceRole);
	}

	@Mutation({ input: goalInput, meta: { permission: "finance.goals.edit" } })
	upsertGoal(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof goalInput>,
	) {
		return this.finance.upsertGoal(ctx.user.id, input);
	}

	@Query({ meta: { permission: "finance.team.performance.own" } })
	myPerformance(@Ctx() ctx: AuthedTrpcContext) {
		return this.finance.performanceForViewer(ctx.user.id, true);
	}

	@Query({ meta: { permission: "finance.team.performance.all" } })
	teamPerformance(@Ctx() ctx: AuthedTrpcContext) {
		return this.finance.performanceForViewer(ctx.user.id, false);
	}

	@Mutation({
		input: weeklyTargetInput,
		meta: { permission: "finance.goals.edit" },
	})
	upsertWeeklyTarget(@Input() input: z.infer<typeof weeklyTargetInput>) {
		return this.finance.upsertWeeklyTarget(input);
	}

	@Query({ meta: { permission: "finance.permissions.edit" } })
	permissionOverrides() {
		return this.finance.permissionOverrides();
	}

	@Mutation({
		input: permissionOverrideInput,
		meta: { permission: "finance.permissions.edit" },
	})
	setPermissionOverride(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof permissionOverrideInput>,
	) {
		return this.finance.setPermissionOverride(ctx.user.id, input);
	}
}
