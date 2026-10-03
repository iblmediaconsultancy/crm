import { Inject } from "@nestjs/common";
import { Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { PermissionMiddleware } from "../trpc/middlewares/permission.middleware";
import {
	fieldByKeyInput,
	fieldCreateInput,
	fieldIdInput,
	fieldListInput,
	fieldReorderInput,
	fieldUpdateArgs,
} from "./fields.contracts";
import { FieldsService } from "./fields.service";

@Router({ alias: "fields" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class FieldsRouter {
	constructor(@Inject(FieldsService) private readonly fields: FieldsService) {}

	@Query({ input: fieldListInput, meta: { permission: "crm.read" } })
	async list(@Input() input: z.infer<typeof fieldListInput>) {
		return this.fields.list(input.entity, input.includeArchived);
	}

	@Query({ input: fieldByKeyInput, meta: { permission: "crm.read" } })
	async byKey(@Input() input: z.infer<typeof fieldByKeyInput>) {
		return this.fields.byKey(input.entity, input.key);
	}

	@Query({ input: fieldIdInput, meta: { permission: "crm.read" } })
	async coverage(@Input("id") id: string) {
		return this.fields.coverage(id);
	}

	@Mutation({
		input: fieldCreateInput,
		meta: { permission: "workspace.manage" },
	})
	async create(@Input() input: z.infer<typeof fieldCreateInput>) {
		return this.fields.create(input);
	}

	@Mutation({
		input: fieldUpdateArgs,
		meta: { permission: "workspace.manage" },
	})
	async update(@Input() input: z.infer<typeof fieldUpdateArgs>) {
		return this.fields.update(input.id, input.data);
	}

	@Mutation({
		input: fieldReorderInput,
		meta: { permission: "workspace.manage" },
	})
	async reorder(@Input() input: z.infer<typeof fieldReorderInput>) {
		return this.fields.reorder(input);
	}

	@Mutation({ input: fieldIdInput, meta: { permission: "workspace.manage" } })
	async archive(@Input("id") id: string) {
		return this.fields.archive(id);
	}

	@Mutation({ input: fieldIdInput, meta: { permission: "workspace.manage" } })
	async restore(@Input("id") id: string) {
		return this.fields.restore(id);
	}

	@Mutation({ input: fieldIdInput, meta: { permission: "workspace.manage" } })
	async delete(@Input("id") id: string) {
		return this.fields.delete(id);
	}

	@Mutation({ input: fieldIdInput, meta: { permission: "workspace.manage" } })
	async backfill(@Input("id") id: string) {
		return this.fields.backfill(id);
	}
}
