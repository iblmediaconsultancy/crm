import { describe, expect, it } from "bun:test";
import { PermissionAccessService } from "../src/workspace/permission-access.service";

describe("system operator workspace access", () => {
	it("allows only the CRM permissions Atlas needs", async () => {
		const service = new PermissionAccessService({
			user: {
				findUnique: async () => ({ kind: "SYSTEM_OPERATOR" }),
			},
			workspacePermissionOverride: {
				findUnique: async () => null,
			},
		} as never);

		expect(await service.can("atlas-operator", "contributor", "crm.read")).toBe(
			true,
		);
		expect(
			await service.can("atlas-operator", "contributor", "crm.create"),
		).toBe(true);
		expect(
			await service.can("atlas-operator", "contributor", "crm.update.owned"),
		).toBe(true);
		expect(
			await service.can("atlas-operator", "contributor", "workspace.manage"),
		).toBe(false);
		expect(
			await service.can("atlas-operator", "contributor", "providers.verify"),
		).toBe(false);
		expect(
			await service.can("atlas-operator", "contributor", "canonical.destroy"),
		).toBe(false);
	});

	it("preserves normal role and override behavior for human users", async () => {
		const service = new PermissionAccessService({
			user: {
				findUnique: async () => ({ kind: "HUMAN" }),
			},
			workspacePermissionOverride: {
				findUnique: async ({
					where,
				}: {
					where: { userId_permission: { permission: string } };
				}) =>
					where.userId_permission.permission === "finance.edit"
						? { allowed: true }
						: null,
			},
		} as never);

		expect(
			await service.can("ihsan-human", "contributor", "finance.edit"),
		).toBe(true);
		expect(await service.can("ihsan-human", "contributor", "crm.read")).toBe(
			true,
		);
	});
});
