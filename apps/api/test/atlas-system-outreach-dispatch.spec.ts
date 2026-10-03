import { describe, expect, test } from "bun:test";
import type { Db } from "@crm/db";
import {
	type AtlasRuntimeReadiness,
	evaluateAtlasSystemReadiness,
} from "../src/providers/atlas-runtime-readiness";
import { OutreachLifecycleService } from "../src/providers/outreach-lifecycle.service";

const runtimeReady: AtlasRuntimeReadiness = {
	bridge: "READY",
	provider: "READY",
	providerReason: null,
};

const stateReady = {
	operatorKind: "SYSTEM_OPERATOR",
	mailbox: {
		ownerUserId: "atlas-operator",
		address: "outreach@iblmedia.com",
		status: "VERIFIED",
	},
	providerCapabilityStatus: "VERIFIED",
	crmLiveOutreachEnabled: true,
	authorization: {
		id: "auth-current",
		expiresAt: new Date(Date.now() + 60_000),
	},
};

async function withLiveOutreachEnabled<T>(work: () => Promise<T>): Promise<T> {
	const original = process.env.ATLAS_LIVE_OUTREACH_ENABLED;
	process.env.ATLAS_LIVE_OUTREACH_ENABLED = "true";
	try {
		return await work();
	} finally {
		if (original === undefined) delete process.env.ATLAS_LIVE_OUTREACH_ENABLED;
		else process.env.ATLAS_LIVE_OUTREACH_ENABLED = original;
	}
}

describe("Atlas system outreach readiness and dispatch", () => {
	test("reports READY for the verified system mailbox without user ownership", () => {
		const readiness = evaluateAtlasSystemReadiness(
			stateReady,
			runtimeReady,
			true,
		);

		expect(readiness.status).toBe("READY");
		expect(readiness.mailbox).toMatchObject({
			status: "READY",
			owner: "ATLAS_SYSTEM_OPERATOR",
			address: "outreach@iblmedia.com",
		});
		expect(readiness.blockers).toEqual([]);
	});

	test("keeps system mailbox readiness separate and blocks when either live gate is off", () => {
		const readiness = evaluateAtlasSystemReadiness(
			{ ...stateReady, crmLiveOutreachEnabled: false },
			runtimeReady,
			true,
		);

		expect(readiness.mailbox).toMatchObject({
			status: "READY",
			owner: "ATLAS_SYSTEM_OPERATOR",
			address: "outreach@iblmedia.com",
		});
		expect(readiness.status).toBe("BLOCKED");
		expect(readiness.blockers).toContain("CRM_LIVE_OUTREACH_DISABLED");
	});

	test("blocks dispatch for missing provider, bridge, or current authorization", () => {
		const readiness = evaluateAtlasSystemReadiness(
			{
				...stateReady,
				providerCapabilityStatus: "UNVERIFIED",
				authorization: null,
			},
			{
				bridge: "UNREACHABLE",
				provider: "BLOCKED",
				providerReason: "RESEND_CREDENTIAL_UNAVAILABLE",
			},
			true,
		);

		expect(readiness.status).toBe("BLOCKED");
		expect(readiness.blockers).toEqual(
			expect.arrayContaining([
				"RESEND_OUTBOUND_UNVERIFIED",
				"RESEND_CREDENTIAL_UNAVAILABLE",
				"AGENT_BRIDGE_UNREACHABLE",
				"OUTREACH_AUTHORIZATION_REQUIRED",
			]),
		);
	});

	test("queues one audited agent task and never creates an outbound delivery directly", async () => {
		const writes: unknown[] = [];
		const task = { id: "task-atlas-cycle", kind: "atlas-outreach" };
		const tx = {
			$executeRaw: async () => 1,
			user: { findUnique: async () => ({ kind: "SYSTEM_OPERATOR" }) },
			mailbox: {
				findUnique: async () => ({
					ownerUserId: "atlas-operator",
					address: "outreach@iblmedia.com",
					status: "VERIFIED",
				}),
			},
			providerCapability: { findUnique: async () => ({ status: "VERIFIED" }) },
			appSetting: {
				findUnique: async () => ({ atlasLiveOutreachEnabled: true }),
			},
			outreachAuthorization: {
				findFirst: async () => ({ id: "auth-current" }),
			},
			agentTask: {
				findFirst: async () => null,
				create: async (input: unknown) => {
					writes.push(input);
					return task;
				},
			},
			domainAuditEvent: {
				create: async (input: unknown) => writes.push(input),
			},
		};
		const db = {
			$transaction: async (callback: (value: typeof tx) => unknown) =>
				callback(tx),
		} as unknown as Db;
		const service = new OutreachLifecycleService(db);
		service.atlasSystemReadiness = async () =>
			evaluateAtlasSystemReadiness(stateReady, runtimeReady, true);

		await withLiveOutreachEnabled(async () => {
			expect(
				await service.dispatchAtlasOutreach({
					userId: "ihsan-human",
					role: "admin",
				}),
			).toEqual({ id: task.id, status: "QUEUED" });
		});
		expect(writes).toHaveLength(2);
		expect(writes[0]).toMatchObject({
			data: {
				kind: "atlas-outreach",
				priority: 1000,
				budget: 8,
				dueAt: expect.any(Date),
			},
		});
		expect(writes[1]).toMatchObject({
			data: {
				actorUserId: "ihsan-human",
				action: "ATLAS_OUTREACH_DISPATCH_REQUESTED",
				entityId: task.id,
				outcome: "SUCCESS",
				metadata: {
					authorizationId: "auth-current",
					triggeredBy: "authenticated_ui",
				},
			},
		});
	});

	test("does not create a task when readiness is blocked or another cycle is active", async () => {
		let taskCreates = 0;
		const tx = {
			$executeRaw: async () => 1,
			user: { findUnique: async () => ({ kind: "SYSTEM_OPERATOR" }) },
			mailbox: {
				findUnique: async () => ({
					ownerUserId: "atlas-operator",
					address: "outreach@iblmedia.com",
					status: "VERIFIED",
				}),
			},
			providerCapability: { findUnique: async () => ({ status: "VERIFIED" }) },
			appSetting: {
				findUnique: async () => ({ atlasLiveOutreachEnabled: true }),
			},
			outreachAuthorization: {
				findFirst: async () => ({ id: "auth-current" }),
			},
			agentTask: {
				findFirst: async () => ({ id: "task-existing" }),
				create: async () => {
					taskCreates += 1;
					return { id: "unexpected" };
				},
			},
			domainAuditEvent: { create: async () => undefined },
		};
		const db = {
			$transaction: async (callback: (value: typeof tx) => unknown) =>
				callback(tx),
		} as unknown as Db;
		const service = new OutreachLifecycleService(db);
		service.atlasSystemReadiness = async () =>
			evaluateAtlasSystemReadiness(
				{ ...stateReady, crmLiveOutreachEnabled: false },
				runtimeReady,
				true,
			);
		await expect(
			service.dispatchAtlasOutreach({ userId: "ihsan-human", role: "admin" }),
		).rejects.toThrow("Atlas Email dispatch is blocked");
		expect(taskCreates).toBe(0);

		service.atlasSystemReadiness = async () =>
			evaluateAtlasSystemReadiness(stateReady, runtimeReady, true);
		await withLiveOutreachEnabled(async () => {
			await expect(
				service.dispatchAtlasOutreach({
					userId: "ihsan-human",
					role: "admin",
				}),
			).rejects.toThrow("already queued or running");
		});
		expect(taskCreates).toBe(0);
	});
});
