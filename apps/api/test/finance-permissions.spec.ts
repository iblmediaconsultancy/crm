import { describe, expect, test } from "bun:test";
import type { Db } from "@crm/db";
import { permissionOverrideInput } from "../src/finance/finance.contracts";
import { PermissionAccessService } from "../src/workspace/permission-access.service";

describe("finance permissions", () => {
	test("allows an explicit grant and respects an explicit block", async () => {
		let allowed: boolean | undefined;
		const service = new PermissionAccessService({
			workspacePermissionOverride: {
				findUnique: async () => (allowed === undefined ? null : { allowed }),
			},
		} as unknown as Db);

		expect(
			await service.can("team-user", "team", "finance.company.profit"),
		).toBe(false);
		expect(
			await service.can("admin-user", "admin", "finance.company.profit"),
		).toBe(true);
		expect(
			await service.can(
				"contributor-user",
				"contributor",
				"finance.company.mrr",
			),
		).toBe(false);
		expect(
			await service.can(
				"contributor-user",
				"contributor",
				"finance.team.performance.own",
			),
		).toBe(true);
		expect(
			await service.can(
				"contributor-user",
				"contributor",
				"finance.compensation.other",
			),
		).toBe(false);
		allowed = true;
		expect(
			await service.can("team-user", "team", "finance.company.profit"),
		).toBe(true);
		allowed = false;
		expect(await service.can("team-user", "team", "finance.company.mrr")).toBe(
			false,
		);
	});

	test("limits permission overrides to finance permissions", () => {
		expect(
			permissionOverrideInput.safeParse({
				userId: "user-1",
				permission: "crm.read",
				allowed: true,
			}).success,
		).toBe(false);
		expect(
			permissionOverrideInput.safeParse({
				userId: "user-1",
				permission: "finance.company.mrr",
				allowed: true,
			}).success,
		).toBe(true);
	});
});
