import { describe, expect, it } from "bun:test";
import {
	assertLocalLinkedInDatabaseAccess,
	localLinkedInDatabaseTarget,
	localLinkedInExecutorGateState,
} from "../src/linkedin/local-linkedin-executor-config";
import { LocalLinkedInWorker } from "../src/linkedin/local-linkedin-worker";

const ready = {
	status: "READY" as const,
	detail: "LINKEDIN_BROWSER_AUTHENTICATED",
	url: "https://www.linkedin.com/feed/",
	title: "Feed | LinkedIn",
};

describe("local LinkedIn executor production gate", () => {
	it("fails closed when the gate is missing or disabled", () => {
		expect(localLinkedInExecutorGateState({}).enabled).toBe(false);
		expect(() =>
			assertLocalLinkedInDatabaseAccess({
				databaseUrl: "postgresql://postgres:postgres@127.0.0.1:5432/crm",
				allowDisposableDatabase: false,
				worker: true,
				env: {},
			}),
		).toThrow("AUTHORITATIVE_CRM_EXECUTION_DISABLED");
	});

	it("allows only the explicitly enabled authoritative target", () => {
		expect(
			localLinkedInDatabaseTarget(
				"postgresql://postgres:postgres@127.0.0.1:5432/crm",
			),
		).toMatchObject({ isLocal: true, isAuthoritative: true });
		expect(
			assertLocalLinkedInDatabaseAccess({
				databaseUrl: "postgresql://postgres:postgres@127.0.0.1:5432/crm",
				allowDisposableDatabase: false,
				worker: true,
				env: { ATLAS_LINKEDIN_LOCAL_EXECUTOR_ENABLED: "true" },
			}),
		).toMatchObject({ isAuthoritative: true });
	});
});

describe("local LinkedIn persistent worker", () => {
	it("stays idle and shuts down cleanly without jobs", async () => {
		let runs = 0;
		let stopChecks = 0;
		const states: string[] = [];
		const worker = new LocalLinkedInWorker(
			{
				runOnce: async () => {
					runs += 1;
					return { status: "IDLE" } as const;
				},
			},
			async () => ready,
			"worker-1",
			1,
			(state) => states.push(state.status),
			() => {
				stopChecks += 1;
				return stopChecks > 1;
			},
		);
		const result = await worker.run();
		expect(runs).toBe(1);
		expect(states).toEqual(["STARTING", "IDLE", "STOPPED"]);
		expect(result.status).toBe("STOPPED");
	});

	it("stops before execution on a LinkedIn challenge", async () => {
		let runs = 0;
		const states: string[] = [];
		const worker = new LocalLinkedInWorker(
			{
				runOnce: async () => {
					runs += 1;
					return { status: "IDLE" } as const;
				},
			},
			async () => ({ ...ready, status: "CHALLENGE" as const }),
			"worker-2",
			1,
			(state) => states.push(state.status),
		);
		const result = await worker.run();
		expect(runs).toBe(0);
		expect(states).toEqual(["STARTING", "NEEDS_IHSAN", "STOPPED"]);
		expect(result.status).toBe("STOPPED");
	});

	it("records one completed action and does not duplicate it", async () => {
		let runs = 0;
		let stopChecks = 0;
		const successful = {
			status: "COMPLETED" as const,
			jobId: "job-1",
			action: "MESSAGE",
		};
		const worker = new LocalLinkedInWorker(
			{
				runOnce: async () => {
					runs += 1;
					return successful;
				},
			},
			async () => ready,
			"worker-3",
			1,
			() => undefined,
			() => {
				stopChecks += 1;
				return stopChecks > 1;
			},
		);
		const result = await worker.run();
		expect(runs).toBe(1);
		expect(result.status).toBe("STOPPED");
	});
});
