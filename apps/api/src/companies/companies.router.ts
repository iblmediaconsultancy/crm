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
	type CanonicalLifecycleInput,
	canonicalBulkLifecycleInput,
	canonicalDeletionImpactInput,
	canonicalDestructiveDeleteInput,
	canonicalLifecycleInput,
} from "../crm/canonical-lifecycle.contracts";
import { CanonicalLifecycleService } from "../crm/canonical-lifecycle.service";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { PermissionMiddleware } from "../trpc/middlewares/permission.middleware";
import {
	companyBulkInput,
	companyBulkOwnerInput,
	companyCreateInput,
	companyIdInput,
	companyListInput,
	companyOptionsInput,
	companyUpdateArgs,
	setPrimaryContactInput,
} from "./companies.contracts";
import { CompaniesService } from "./companies.service";

@Router({ alias: "companies" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class CompaniesRouter {
	constructor(
		@Inject(CompaniesService) private readonly companies: CompaniesService,
		@Inject(CanonicalLifecycleService)
		private readonly lifecycle: CanonicalLifecycleService,
	) {}

	@Query({ input: companyListInput, meta: { permission: "crm.read" } })
	async list(@Input() input: z.infer<typeof companyListInput>) {
		return this.companies.list(input);
	}

	@Query({ input: companyIdInput, meta: { permission: "crm.read" } })
	async byId(@Input("id") id: string) {
		return this.companies.byId(id);
	}

	@Query({ input: companyOptionsInput, meta: { permission: "crm.read" } })
	async options(@Input("q") q: string) {
		return this.companies.options(q);
	}

	@Mutation({ input: companyCreateInput, meta: { permission: "crm.create" } })
	async create(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof companyCreateInput>,
	) {
		return this.companies.create(
			this.lifecycle.ownerForCreate(input, {
				userId: ctx.user.id,
				role: ctx.workspaceRole,
			}),
		);
	}

	@Mutation({
		input: companyUpdateArgs,
		meta: { permission: "crm.update.owned" },
	})
	async update(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof companyUpdateArgs>,
	) {
		await this.lifecycle.assertCanUpdate("company", input.id, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
		return this.companies.update(input.id, input.data);
	}

	@Mutation({
		input: canonicalLifecycleInput,
		meta: { permission: "crm.archive" },
	})
	async archive(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: CanonicalLifecycleInput,
	) {
		return this.lifecycle.archive("company", input, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
	}

	@Mutation({
		input: canonicalBulkLifecycleInput,
		meta: { permission: "crm.archive" },
	})
	async bulkArchive(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof canonicalBulkLifecycleInput>,
	) {
		return this.lifecycle.bulkArchive("company", input, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
	}
	@Mutation({
		input: canonicalLifecycleInput,
		meta: { permission: "crm.restore" },
	})
	async restore(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: CanonicalLifecycleInput,
	) {
		return this.lifecycle.restore("company", input, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
	}

	@Mutation({
		input: companyBulkOwnerInput,
		meta: { permission: "crm.bulk.assign" },
	})
	async bulkAssignOwner(@Input() input: z.infer<typeof companyBulkOwnerInput>) {
		return this.companies.bulkAssignOwner(input);
	}

	@Mutation({
		input: companyBulkInput,
		meta: { permission: "crm.update.shared" },
	})
	async bulkEnrich(@Input("ids") ids: string[]) {
		return this.companies.bulkEnrich(ids);
	}

	@Mutation({ input: companyIdInput, meta: { permission: "crm.update.owned" } })
	async enrich(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		await this.lifecycle.assertCanUpdate("company", id, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
		return this.companies.enrich(id);
	}

	@Mutation({ input: companyIdInput, meta: { permission: "crm.update.owned" } })
	async research(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		await this.lifecycle.assertCanUpdate("company", id, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
		return this.companies.research(id, ctx.user.id);
	}

	@Mutation({
		input: setPrimaryContactInput,
		meta: { permission: "crm.update.owned" },
	})
	async setPrimaryContact(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setPrimaryContactInput>,
	) {
		await this.lifecycle.assertCanUpdate("company", input.companyId, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
		return this.companies.setPrimaryContact(input.companyId, input.contactId);
	}
	@Query({
		input: canonicalDeletionImpactInput,
		meta: { permission: "canonical.destroy" },
	})
	destructionImpact(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.lifecycle.deletionImpact("company", id, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
	}

	@Mutation({
		input: canonicalDestructiveDeleteInput,
		meta: { permission: "canonical.destroy" },
	})
	destructiveDelete(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof canonicalDestructiveDeleteInput>,
	) {
		return this.lifecycle.destructiveDelete("company", input, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
	}
}
