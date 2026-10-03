import { beforeEach, describe, expect, it, mock } from "bun:test";

type Membership = {
	organizationId: string;
	user: { profile: { status: string } | null };
};

const findUnique = mock(
	async (_input: unknown): Promise<Membership | null> => null,
);

mock.module("@crm/db", () => ({
	db: { member: { findUnique } },
}));

const { ensureWorkspaceMembership, WORKSPACE_ID } = await import(
	"../src/organization"
);

describe("ensureWorkspaceMembership", () => {
	beforeEach(() => {
		findUnique.mockReset();
		findUnique.mockResolvedValue(null);
	});

	it("returns the workspace for an active member", async () => {
		findUnique.mockResolvedValue({
			organizationId: WORKSPACE_ID,
			user: { profile: { status: "ACTIVE" } },
		});

		expect(await ensureWorkspaceMembership("active-user")).toBe(WORKSPACE_ID);
		expect(findUnique).toHaveBeenCalledWith({
			where: {
				organizationId_userId: {
					organizationId: WORKSPACE_ID,
					userId: "active-user",
				},
			},
			select: {
				organizationId: true,
				user: { select: { profile: { select: { status: true } } } },
			},
		});
	});

	it("does not return a workspace when there is no membership", async () => {
		expect(await ensureWorkspaceMembership("unlinked-user")).toBeUndefined();
	});

	it("does not return a workspace for an inactive profile", async () => {
		findUnique.mockResolvedValue({
			organizationId: WORKSPACE_ID,
			user: { profile: { status: "SUSPENDED" } },
		});

		expect(await ensureWorkspaceMembership("suspended-user")).toBeUndefined();
	});

	it("does not return a workspace when the profile is missing", async () => {
		findUnique.mockResolvedValue({
			organizationId: WORKSPACE_ID,
			user: { profile: null },
		});

		expect(await ensureWorkspaceMembership("unprofiled-user")).toBeUndefined();
	});
});
