import { describe, expect, test } from "bun:test";
import type { Db } from "@crm/db";
import { OutreachLifecycleService } from "../src/providers/outreach-lifecycle.service";

describe("Atlas authorization lifecycle", () => {
	test("does not materialize cold follow-up plans while execution gates are disabled", async () => {
		const originalLive = process.env.ATLAS_LIVE_OUTREACH_ENABLED;
		const originalScheduled = process.env.ATLAS_SCHEDULED_EXECUTION_ENABLED;
		delete process.env.ATLAS_LIVE_OUTREACH_ENABLED;
		delete process.env.ATLAS_SCHEDULED_EXECUTION_ENABLED;
		try {
			const db = {
				$transaction: async () => {
					throw new Error(
						"Transaction must not start while execution is gated",
					);
				},
			} as unknown as Db;
			const service = new OutreachLifecycleService(db);

			expect(await service.materializePendingPlans()).toEqual({
				inspected: 0,
				created: 0,
			});
		} finally {
			if (originalLive === undefined)
				delete process.env.ATLAS_LIVE_OUTREACH_ENABLED;
			else process.env.ATLAS_LIVE_OUTREACH_ENABLED = originalLive;
			if (originalScheduled === undefined)
				delete process.env.ATLAS_SCHEDULED_EXECUTION_ENABLED;
			else process.env.ATLAS_SCHEDULED_EXECUTION_ENABLED = originalScheduled;
		}
	});

	test("issues a scoped authorization and persists its audit event", async () => {
		const events: unknown[] = [];
		const transactions: unknown[] = [];
		const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
		const authorization = {
			id: "auth-new",
			status: "ACTIVE" as const,
			scope: "STANDARD_COLD_OUTREACH" as const,
			authorizedById: "ihsan-human",
			expiresAt,
		};
		const tx = {
			$executeRaw: async () => 1,
			outreachAuthorization: {
				findMany: async () => [],
				updateMany: async (input: unknown) => {
					transactions.push(input);
					return { count: 1 };
				},
				create: async (input: { data: unknown }) => {
					transactions.push(input);
					return authorization;
				},
			},
			domainAuditEvent: {
				create: async (input: unknown) => events.push(input),
			},
		};
		const db = {
			$transaction: async (callback: (transaction: typeof tx) => unknown) =>
				callback(tx),
		} as unknown as Db;
		const service = new OutreachLifecycleService(db);

		expect(
			await service.issueAtlasAuthorization(
				{ userId: "ihsan-human", role: "admin" },
				{ expiresAt },
			),
		).toMatchObject(authorization);
		expect(transactions[0]).toEqual({
			where: { scope: "STANDARD_COLD_OUTREACH", status: "ACTIVE" },
			data: {
				status: "REVOKED",
				revokedById: "ihsan-human",
				revokedAt: expect.any(Date),
				revocationReason: "Superseded by a newer authorization",
			},
		});
		expect(transactions[1]).toEqual({
			data: {
				authorizedById: "ihsan-human",
				expiresAt,
				followUpCohortId: null,
			},
		});
		expect(events).toEqual([
			{
				data: {
					actorUserId: "ihsan-human",
					action: "ATLAS_OUTREACH_AUTHORIZATION_ISSUED",
					entityType: "OUTREACH",
					entityId: "auth-new",
					outcome: "SUCCESS",
					requestId: "atlas-authorization:issued:auth-new",
					metadata: {
						scope: "STANDARD_COLD_OUTREACH",
						expiresAt: expiresAt.toISOString(),
						followUpCohortId: null,
						followUpStepCount: null,
					},
				},
			},
		]);
	});

	test("rejects a contributor before attempting an authorization write", async () => {
		const db = {
			$transaction: async () => {
				throw new Error("Transaction must not start");
			},
		} as unknown as Db;
		const service = new OutreachLifecycleService(db);

		await expect(
			service.issueAtlasAuthorization(
				{ userId: "contributor", role: "contributor" },
				{ expiresAt: new Date(Date.now() + 60_000) },
			),
		).rejects.toThrow("Manager access is required.");
	});

	test("revokes an active authorization and preserves the reason in the audit", async () => {
		const events: Array<{ data: Record<string, unknown> }> = [];
		const calls: Array<Record<string, unknown>> = [];
		const tx = {
			$executeRaw: async () => 1,
			outreachAuthorization: {
				findFirst: async () => ({ followUpCohortId: null }),
				updateMany: async (input: Record<string, unknown>) => {
					calls.push(input);
					return { count: 1 };
				},
			},
			domainAuditEvent: {
				create: async (input: { data: Record<string, unknown> }) =>
					events.push(input),
			},
		};
		const db = {
			$transaction: async (callback: (transaction: typeof tx) => unknown) =>
				callback(tx),
		} as unknown as Db;
		const service = new OutreachLifecycleService(db);

		expect(
			await service.revokeAtlasAuthorization(
				{ userId: "ihsan-human", role: "team" },
				{ id: "auth-active", reason: "Session finished" },
			),
		).toEqual({ id: "auth-active", status: "REVOKED" });
		expect(calls[0]).toEqual({
			where: {
				id: "auth-active",
				scope: "STANDARD_COLD_OUTREACH",
				status: "ACTIVE",
			},
			data: {
				status: "REVOKED",
				revokedById: "ihsan-human",
				revokedAt: expect.any(Date),
				revocationReason: "Session finished",
			},
		});
		expect(events).toHaveLength(1);
		expect(events[0]?.data).toMatchObject({
			actorUserId: "ihsan-human",
			action: "ATLAS_OUTREACH_AUTHORIZATION_REVOKED",
			entityId: "auth-active",
			outcome: "SUCCESS",
			metadata: { reason: "Session finished" },
		});
		expect(events[0]?.data.requestId).toStartWith(
			"atlas-authorization:revoked:auth-active:",
		);
	});
});
