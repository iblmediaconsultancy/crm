import { describe, expect, test } from "bun:test";
import { workspaceRoles } from "../packages/auth/src/access";
import { WORKSPACE_ROLES } from "../packages/auth/src/organization";

describe("IBL role map", () => {
	test("server role map is exact", () => {
		expect(Object.keys(workspaceRoles).sort()).toEqual(
			[...WORKSPACE_ROLES].sort(),
		);
	});
});
