import { describe, expect, it } from "bun:test";
import { ConflictException } from "@nestjs/common";
import { verifyMailboxInput } from "../src/provider-capabilities/provider-capabilities.contracts";
import { ProviderCapabilitiesService } from "../src/provider-capabilities/provider-capabilities.service";

function fakeDb(capabilityStatus: string) {
	const auditEvents: unknown[] = [];
	const tx = {
		$executeRaw: async () => 0,
		providerCapability: {
			findUnique: async () => ({ status: capabilityStatus }),
		},
		$queryRaw: async () => [
			{
				id: "mailbox-1",
				address: "outreach@iblmedia.com",
				status: "VERIFIED",
				verifiedAt: new Date("2026-09-18T12:00:00.000Z"),
			},
		],
		securityAuditEvent: {
			create: async (input: unknown) => {
				auditEvents.push(input);
			},
		},
	};
	return {
		db: {
			$transaction: async <T>(run: (transaction: typeof tx) => Promise<T>) =>
				run(tx),
		},
		auditEvents,
	};
}

describe("outreach mailbox verification", () => {
	it("accepts the empty admin/team operation input", () => {
		expect(verifyMailboxInput.safeParse({}).success).toBe(true);
	});

	it("requires the MIAB probe to be verified before changing the mailbox", async () => {
		const { db } = fakeDb("UNVERIFIED");
		const service = new ProviderCapabilitiesService(db as never);

		await expect(service.verifyMailbox("admin-1")).rejects.toBeInstanceOf(
			ConflictException,
		);
	});

	it("verifies the seeded mailbox after a verified MIAB probe", async () => {
		const { db, auditEvents } = fakeDb("VERIFIED");
		const service = new ProviderCapabilitiesService(db as never);

		await expect(service.verifyMailbox("admin-1")).resolves.toMatchObject({
			address: "outreach@iblmedia.com",
			status: "VERIFIED",
		});
		expect(auditEvents).toHaveLength(1);
	});
});
