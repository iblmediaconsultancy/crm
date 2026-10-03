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
	removeManualRateInput,
	setManualRateInput,
	setReportingCurrencyInput,
} from "./currency.contracts";
import { CurrencyService } from "./currency.service";

@Router({ alias: "currency" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class CurrencyRouter {
	constructor(
		@Inject(CurrencyService) private readonly currency: CurrencyService,
	) {}

	@Query({ meta: { permission: "crm.read" } })
	async settings(@Ctx() ctx: AuthedTrpcContext) {
		return this.currency.settings(ctx.user.id);
	}

	@Mutation({
		input: setReportingCurrencyInput,
		meta: { permission: "finance.edit" },
	})
	async setReportingCurrency(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setReportingCurrencyInput>,
	) {
		return this.currency.setReportingCurrency(ctx.user.id, input.currency);
	}

	@Mutation({ input: setManualRateInput, meta: { permission: "finance.edit" } })
	async setManualRate(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setManualRateInput>,
	) {
		return this.currency.setManualRate(ctx.user.id, input.currency, input.rate);
	}

	@Mutation({
		input: removeManualRateInput,
		meta: { permission: "finance.edit" },
	})
	async removeManualRate(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof removeManualRateInput>,
	) {
		return this.currency.removeManualRate(ctx.user.id, input.currency);
	}

	@Mutation({ meta: { permission: "finance.edit" } })
	async refreshRates(@Ctx() ctx: AuthedTrpcContext) {
		return this.currency.refresh(ctx.user.id);
	}
}
