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
	await db.userProfile.create({ data: { userId: user.id, status: "ACTIVE" } });

	return user.id;
};

const addMembership = async (userId: string, role: string) => {
	await db.member.create({
		data: {
			id: `${suffix}-${userId}-membership`,
			organizationId: WORKSPACE_ID,
			userId,
			role,
			createdAt: new Date(),
		},
	});
};

const roleOf = async (userId: string): Promise<string | null> => {
	const member = await db.member.findUnique({
		where: { organizationId_userId: { organizationId: WORKSPACE_ID, userId } },
		select: { role: true },
	});

	return member?.role ?? null;
};

const clear = async () => {
	await db.member.deleteMany({ where: { organizationId: WORKSPACE_ID } });
	await db.organization.deleteMany({ where: { id: WORKSPACE_ID } });
	await db.user.deleteMany({
		where: { email: { endsWith: `.${suffix}@example.test` } },
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

	firstId = await seedUser("first", new Date("2020-01-01T00:00:00Z"));
	secondId = await seedUser("second", new Date("2021-01-01T00:00:00Z"));
	await db.organization.create({
		data: {
			id: WORKSPACE_ID,
			name: "Test workspace",
			slug: suffix,
			createdAt: new Date(),
		},
	});
	await addMembership(firstId, "admin");
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
	it("does not enroll a user who has no existing workspace membership", async () => {
		expect(await ensureWorkspaceMembership(secondId)).toBeUndefined();
		expect(await roleOf(firstId)).toBe("admin");
		expect(await roleOf(secondId)).toBeNull();
	});

	it("returns access for an active existing member without changing the assigned role", async () => {
		await addMembership(secondId, "team");

		expect(await ensureWorkspaceMembership(secondId)).toBe(WORKSPACE_ID);
		expect(await ensureWorkspaceMembership(secondId)).toBe(WORKSPACE_ID);

		const rows = await db.member.findMany({
			where: { organizationId: WORKSPACE_ID, userId: secondId },
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.role).toBe("team");
	});

	it("does not grant workspace access to a member with an inactive profile", async () => {
		await addMembership(secondId, "team");
		await db.userProfile.update({
			where: { userId: secondId },
			data: { status: "SUSPENDED" },
		});

		expect(await ensureWorkspaceMembership(secondId)).toBeUndefined();
		expect(await roleOf(secondId)).toBe("team");
	});
});
