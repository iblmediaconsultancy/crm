import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { db } from "@crm/db";
import { ensureWorkspaceMembership, WORKSPACE_ID } from "../src/organization";

const suffix = process.env.TEST_RUN_ID ?? "organization-spec";

const emailOf = (label: string) => `${label}.${suffix}@example.test`;

type Snapshot = {
	organization: {
		name: string;
		slug: string;
		website: string | null;
		metadata: string | null;
	} | null;
	members: { id: string; userId: string; role: string; createdAt: Date }[];
};

let snapshot: Snapshot;
let firstId: string;
let secondId: string;

const seedUser = async (label: string, createdAt: Date): Promise<string> => {
	const user = await db.user.create({
		data: {
			id: `${suffix}-${label}`,
			name: label,
			email: emailOf(label),
			createdAt,
			updatedAt: createdAt,
		},
		select: { id: true },
	});

	return user.id;
};

const clear = async () => {
	await db.member.deleteMany({ where: { organizationId: WORKSPACE_ID } });
	await db.organization.deleteMany({ where: { id: WORKSPACE_ID } });
	await db.user.deleteMany({
		where: { email: { endsWith: `.${suffix}@example.test` } },
	});
};

const createWorkspace = async () => {
	await db.organization.create({
		data: {
			id: WORKSPACE_ID,
			name: "Integration test workspace",
			slug: `${suffix}-workspace`,
			createdAt: new Date(),
		},
	});
};

beforeAll(async () => {
	const organization = await db.organization.findUnique({
		where: { id: WORKSPACE_ID },
		select: { name: true, slug: true, website: true, metadata: true },
	});

	snapshot = {
		organization,
		members: await db.member.findMany({
			where: { organizationId: WORKSPACE_ID },
			select: { id: true, userId: true, role: true, createdAt: true },
		}),
	};
});

beforeEach(async () => {
	await clear();
	await createWorkspace();

	firstId = await seedUser("first", new Date("2020-01-01T00:00:00Z"));
	secondId = await seedUser("second", new Date("2021-01-01T00:00:00Z"));
	await db.userProfile.createMany({
		data: [{ userId: firstId }, { userId: secondId }],
	});
	await db.member.create({
		data: {
			id: `${suffix}-first-member`,
			organizationId: WORKSPACE_ID,
			userId: firstId,
			role: "admin",
			createdAt: new Date("2020-01-01T00:00:00Z"),
		},
	});
});

afterAll(async () => {
	await clear();

	if (snapshot.organization) {
		await db.organization.create({
			data: {
				id: WORKSPACE_ID,
				createdAt: new Date(),
				...snapshot.organization,
			},
		});

		await db.member.createMany({
			data: snapshot.members.map((member) => ({
				...member,
				organizationId: WORKSPACE_ID,
			})),
		});
	}
});

describe("ensureWorkspaceMembership", () => {
	it("returns the workspace for an active member", async () => {
		await db.member.create({
			data: {
				id: `${suffix}-second-member`,
				organizationId: WORKSPACE_ID,
				userId: secondId,
				role: "team",
				createdAt: new Date("2021-01-01T00:00:00Z"),
			},
		});

		expect(await ensureWorkspaceMembership(secondId)).toBe(WORKSPACE_ID);
	});

	it("does not return a workspace for a user without membership", async () => {
		expect(await ensureWorkspaceMembership(secondId)).toBeUndefined();
	});

	it("does not return a workspace for an inactive profile", async () => {
		await db.member.create({
			data: {
				id: `${suffix}-second-member`,
				organizationId: WORKSPACE_ID,
				userId: secondId,
				role: "team",
				createdAt: new Date("2021-01-01T00:00:00Z"),
			},
		});
		await db.userProfile.update({
			where: { userId: secondId },
			data: { status: "SUSPENDED" },
		});

		expect(await ensureWorkspaceMembership(secondId)).toBeUndefined();
	});
});
