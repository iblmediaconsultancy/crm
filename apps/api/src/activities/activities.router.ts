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
	activityCreateInput,
	completeInput,
	myTasksInput,
	timelineCountsInput,
	timelineInput,
} from "./activities.contracts";
import { ActivitiesService } from "./activities.service";

@Router({ alias: "activities" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class ActivitiesRouter {
	constructor(
		@Inject(ActivitiesService) private readonly activities: ActivitiesService,
	) {}

	@Query({ input: timelineInput, meta: { permission: "crm.read" } })
	async timeline(@Input() input: z.infer<typeof timelineInput>) {
		return this.activities.timeline(input);
	}

	@Query({ input: timelineCountsInput, meta: { permission: "crm.read" } })
	async timelineCounts(@Input() input: z.infer<typeof timelineCountsInput>) {
		return this.activities.timelineCounts(input);
	}

	@Query({ input: myTasksInput, meta: { permission: "crm.read" } })
	async myTasks(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof myTasksInput>,
	) {
		return this.activities.myTasks(input, ctx.user.id);
	}

	@Mutation({ input: activityCreateInput, meta: { permission: "crm.create" } })
	async create(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof activityCreateInput>,
	) {
		return this.activities.create(input, ctx.user.id);
	}

	@Mutation({ input: completeInput, meta: { permission: "crm.update.owned" } })
	async complete(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof completeInput>,
	) {
		return this.activities.complete(input.id, input.completed, ctx.user.id);
	}
}
