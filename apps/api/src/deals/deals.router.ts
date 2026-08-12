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
import {
	canonicalLifecycleInput,
	canonicalDeletionImpactInput,
	canonicalDestructiveDeleteInput,
	canonicalBulkLifecycleInput,
	type CanonicalLifecycleInput,
} from "../crm/canonical-lifecycle.contracts";
import { CanonicalLifecycleService } from "../crm/canonical-lifecycle.service";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { PermissionMiddleware } from "../trpc/middlewares/permission.middleware";
import {
	dealAttachContactInput,
	dealBulkOwnerInput,
	dealBulkStageInput,
	dealContactRoleInput,
	dealContactsInput,
	dealCreateInput,
	dealDetachContactInput,
	dealIdInput,
	dealListInput,
	dealUpdateArgs,
	setStageInput,
} from "./deals.contracts";
import { DealsService } from "./deals.service";

@Router({ alias: "deals" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class DealsRouter {
	constructor(
		@Inject(DealsService) private readonly deals: DealsService,
		@Inject(CanonicalLifecycleService)
		private readonly lifecycle: CanonicalLifecycleService,
	) {}

	@Query({ input: dealListInput, meta: { permission: "crm.read" } })
	async list(@Input() input: z.infer<typeof dealListInput>) {
		return this.deals.list(input);
	}

	@Query({ input: dealIdInput, meta: { permission: "crm.read" } })
	async byId(@Input("id") id: string) {
		return this.deals.byId(id);
	}

	@Mutation({ input: dealCreateInput, meta: { permission: "crm.create" } })
	async create(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof dealCreateInput>,
	) {
		return this.deals.create(
			this.lifecycle.ownerForCreate(input, {
				userId: ctx.user.id,
				role: ctx.workspaceRole,
			}),
		);
	}

	@Mutation({ input: dealUpdateArgs, meta: { permission: "crm.update.owned" } })
	async update(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof dealUpdateArgs>,
	) {
		await this.lifecycle.assertCanUpdate("deal", input.id, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
		return this.deals.update(input.id, input.data);
	}

	@Mutation({ input: canonicalLifecycleInput, meta: { permission: "crm.archive" } })
	async archive(@Ctx() ctx: AuthedTrpcContext, @Input() input: CanonicalLifecycleInput) {
		return this.lifecycle.archive("deal", input, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
	}

	@Mutation({ input: canonicalBulkLifecycleInput, meta: { permission: "crm.archive" } })
	async bulkArchive(@Ctx() ctx: AuthedTrpcContext, @Input() input: z.infer<typeof canonicalBulkLifecycleInput>) {
		return this.lifecycle.bulkArchive("deal", input, { userId: ctx.user.id, role: ctx.workspaceRole });
	}
	@Mutation({ input: canonicalLifecycleInput, meta: { permission: "crm.restore" } })
	async restore(@Ctx() ctx: AuthedTrpcContext, @Input() input: CanonicalLifecycleInput) {
		return this.lifecycle.restore("deal", input, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
	}

	@Mutation({ input: setStageInput, meta: { permission: "crm.update.owned" } })
	async setStage(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setStageInput>,
	) {
		await this.lifecycle.assertCanUpdate("deal", input.id, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
		return this.deals.setStage(input, ctx.user.id);
	}

	@Query({ input: dealContactsInput, meta: { permission: "crm.read" } })
	async contactOptions(@Input("dealId") dealId: string) {
		return this.deals.contactOptions(dealId);
	}

	@Mutation({ input: dealAttachContactInput, meta: { permission: "crm.update.owned" } })
	async attachContact(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof dealAttachContactInput>,
	) {
		await this.lifecycle.assertCanUpdate("deal", input.dealId, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
		return this.deals.attachContact(input);
	}

	@Mutation({ input: dealDetachContactInput, meta: { permission: "crm.update.owned" } })
	async detachContact(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof dealDetachContactInput>,
	) {
		await this.lifecycle.assertCanUpdate("deal", input.dealId, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
		return this.deals.detachContact(input);
	}

	@Mutation({ input: dealContactRoleInput, meta: { permission: "crm.update.owned" } })
	async setContactRole(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof dealContactRoleInput>,
	) {
		await this.lifecycle.assertCanUpdate("deal", input.dealId, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
		return this.deals.setContactRole(input);
	}

	@Mutation({ input: dealBulkOwnerInput, meta: { permission: "crm.bulk.assign" } })
	async bulkAssignOwner(@Input() input: z.infer<typeof dealBulkOwnerInput>) {
		return this.deals.bulkAssignOwner(input);
	}

	@Mutation({ input: dealBulkStageInput, meta: { permission: "crm.update.shared" } })
	async bulkSetStage(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof dealBulkStageInput>,
	) {
		return this.deals.bulkSetStage(input, ctx.user.id);
	}
	@Query({ input: canonicalDeletionImpactInput, meta: { permission: "canonical.destroy" } })
	destructionImpact(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.lifecycle.deletionImpact("deal", id, { userId: ctx.user.id, role: ctx.workspaceRole });
	}

	@Mutation({ input: canonicalDestructiveDeleteInput, meta: { permission: "canonical.destroy" } })
	destructiveDelete(@Ctx() ctx: AuthedTrpcContext, @Input() input: z.infer<typeof canonicalDestructiveDeleteInput>) {
		return this.lifecycle.destructiveDelete("deal", input, { userId: ctx.user.id, role: ctx.workspaceRole });
	}
}