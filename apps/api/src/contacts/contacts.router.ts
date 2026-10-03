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
	contactBulkCompanyInput,
	contactBulkInput,
	contactBulkOwnerInput,
	contactCreateInput,
	contactIdInput,
	contactListInput,
	contactUpdateArgs,
	factDecisionInput,
} from "./contacts.contracts";
import { ContactsService } from "./contacts.service";

@Router({ alias: "contacts" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class ContactsRouter {
	constructor(
		@Inject(ContactsService) private readonly contacts: ContactsService,
		@Inject(CanonicalLifecycleService)
		private readonly lifecycle: CanonicalLifecycleService,
	) {}

	@Query({ input: contactListInput, meta: { permission: "crm.read" } })
	async list(@Input() input: z.infer<typeof contactListInput>) {
		return this.contacts.list(input);
	}

	@Query({ input: contactIdInput, meta: { permission: "crm.read" } })
	async byId(@Input("id") id: string) {
		return this.contacts.byId(id);
	}

	@Mutation({ input: contactCreateInput, meta: { permission: "crm.create" } })
	async create(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof contactCreateInput>,
	) {
		return this.contacts.create(
			this.lifecycle.ownerForCreate(input, {
				userId: ctx.user.id,
				role: ctx.workspaceRole,
			}),
		);
	}

	@Mutation({
		input: contactUpdateArgs,
		meta: { permission: "crm.update.owned" },
	})
	async update(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof contactUpdateArgs>,
	) {
		await this.lifecycle.assertCanUpdate("contact", input.id, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
		return this.contacts.update(input.id, input.data);
	}

	@Mutation({
		input: canonicalLifecycleInput,
		meta: { permission: "crm.archive" },
	})
	async archive(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: CanonicalLifecycleInput,
	) {
		return this.lifecycle.archive("contact", input, {
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
		return this.lifecycle.bulkArchive("contact", input, {
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
		return this.lifecycle.restore("contact", input, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
	}

	@Mutation({ input: contactIdInput, meta: { permission: "crm.update.owned" } })
	async enrich(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		await this.lifecycle.assertCanUpdate("contact", id, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
		return this.contacts.enrich(id);
	}

	@Mutation({
		input: contactBulkOwnerInput,
		meta: { permission: "crm.bulk.assign" },
	})
	async bulkAssignOwner(@Input() input: z.infer<typeof contactBulkOwnerInput>) {
		return this.contacts.bulkAssignOwner(input);
	}

	@Mutation({
		input: contactBulkCompanyInput,
		meta: { permission: "crm.update.shared" },
	})
	async bulkSetCompany(
		@Input() input: z.infer<typeof contactBulkCompanyInput>,
	) {
		return this.contacts.bulkSetCompany(input);
	}

	@Mutation({
		input: contactBulkInput,
		meta: { permission: "crm.update.shared" },
	})
	async bulkEnrich(@Input("ids") ids: string[]) {
		return this.contacts.bulkEnrich(ids);
	}

	@Mutation({
		input: factDecisionInput,
		meta: { permission: "crm.update.owned" },
	})
	async decideFact(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof factDecisionInput>,
	) {
		return this.contacts.decideFact(input, ctx.user.id);
	}
	@Query({
		input: canonicalDeletionImpactInput,
		meta: { permission: "canonical.destroy" },
	})
	destructionImpact(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.lifecycle.deletionImpact("contact", id, {
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
		return this.lifecycle.destructiveDelete("contact", input, {
			userId: ctx.user.id,
			role: ctx.workspaceRole,
		});
	}
}
