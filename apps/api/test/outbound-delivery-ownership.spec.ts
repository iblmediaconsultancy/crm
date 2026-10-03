import { describe, expect, test } from "bun:test";
import type { Db } from "@crm/db";
import { OutboundDeliveryService } from "../src/providers/outbound-delivery.service";

function buildDb(draft: Record<string, unknown>) {
	const writes: string[] = [];
	const tx = {
		$executeRaw: async () => 1,
		providerCapability: {
			findUnique: async () => ({ status: "VERIFIED" }),
		},
		draft: {
			findUnique: async () => draft,
			update: async () => {
				writes.push("draft.update");
			},
		},
		contactRouteConsent: { findUnique: async () => null },
		footballPlayer: { findUnique: async () => null },
		suppressedContact: { findUnique: async () => null },
		suppressedDomain: { findUnique: async () => null },
		outboundDelivery: {
			upsert: async () => {
				writes.push("outboundDelivery.upsert");
				return { id: "delivery-1", status: "PENDING", providerMessageId: null };
			},
		},
		domainAuditEvent: {
			create: async () => {
				writes.push("domainAuditEvent.create");
			},
		},
	};
	const db = {
		$transaction: async (callback: (value: typeof tx) => unknown) =>
			callback(tx),
	} as unknown as Db;
	return { db, writes };
}

function approvedDraft(ownerUserId: string, mailboxOwnerUserId: string) {
	return {
		id: "draft-1",
		status: "APPROVED",
		coldOutreach: false,
		subject: "A question about media support",
		body: "Would a short overview be useful?",
		ownerUserId,
		mailbox: { ownerUserId: mailboxOwnerUserId, status: "VERIFIED" },
		recipientRoute: {
			id: "route-1",
			type: "EMAIL",
			lifecycleState: "ACTIVE",
			normalizedValue: "contact@example.test",
			contact: {
				id: "contact-1",
				firstName: "Alex",
				lastName: "Agent",
				lifecycleState: "ACTIVE",
				outreachState: "ALLOWED",
			},
		},
		outreachApproval: {
			status: "APPROVED",
			requestedById: "requester",
			decidedById: "approver",
			decidedAt: new Date(),
		},
	};
}

describe("personal draft send ownership", () => {
	test("rejects Atlas-owned drafts and mailboxes for a signed-in user", async () => {
		const { db, writes } = buildDb(
			approvedDraft("atlas-operator", "atlas-operator"),
		);
		const service = new OutboundDeliveryService(db);

		await expect(
			service.queueApprovedDraft("ihsan-human", "draft-1"),
		).rejects.toThrow("OUTBOUND_SENDER_MISMATCH");
		expect(writes).toEqual([]);
	});

	test("continues to queue an approved draft owned by the signed-in user", async () => {
		const { db, writes } = buildDb(approvedDraft("ihsan-human", "ihsan-human"));
		const service = new OutboundDeliveryService(db);

		expect(await service.queueApprovedDraft("ihsan-human", "draft-1")).toEqual({
			status: "QUEUED",
			deliveryId: "delivery-1",
			duplicate: false,
		});
		expect(writes).toEqual([
			"outboundDelivery.upsert",
			"draft.update",
			"domainAuditEvent.create",
		]);
	});
});
