import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CdpLinkedInBrowserAdapter } from "./cdp-linkedin-browser-adapter";
import type { LinkedInRoutineActionInput } from "./linkedin-action-queue.service";
import type { LinkedInChannelService } from "./linkedin-channel.service";
import { LocalLinkedInExecutor } from "./local-linkedin-executor";
import {
	assertLocalLinkedInDatabaseAccess,
	localLinkedInDatabaseTarget,
	localLinkedInExecutorEnabled,
	localLinkedInExecutorGateState,
} from "./local-linkedin-executor-config";
import {
	LocalLinkedInWorker,
	type LocalLinkedInWorkerState,
} from "./local-linkedin-worker";

type BrowserKind = "chrome" | "edge";

function option(name: string, fallback: string): string {
	const index = process.argv.indexOf(name);
	return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function numberOption(name: string, fallback: number): number {
	const value = Number(option(name, String(fallback)));
	return Number.isInteger(value) && value > 0 ? value : fallback;
}

function profileDirectory(): string {
	return resolve(
		option(
			"--profile",
			join(
				process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
				"Atlas",
				"LinkedInBrowser",
			),
		),
	);
}

function browserExecutable(kind: BrowserKind): string {
	const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
	const programFilesX86 =
		process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
	const candidates =
		kind === "edge"
			? [
					join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
					join(
						programFilesX86,
						"Microsoft",
						"Edge",
						"Application",
						"msedge.exe",
					),
				]
			: [
					join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
					join(
						programFilesX86,
						"Google",
						"Chrome",
						"Application",
						"chrome.exe",
					),
				];
	const executable = candidates.find(existsSync);
	if (!executable) throw new Error(`LINKEDIN_${kind.toUpperCase()}_NOT_FOUND`);
	return executable;
}

function pidPath(): string {
	return join(profileDirectory(), "executor.pid");
}

function workerPidPath(): string {
	return join(profileDirectory(), "worker.pid");
}

function workerStatePath(): string {
	return join(profileDirectory(), "worker-state.json");
}

function workerStopPath(): string {
	return join(profileDirectory(), "worker.stop");
}

function writeWorkerState(state: LocalLinkedInWorkerState): void {
	mkdirSync(profileDirectory(), { recursive: true });
	writeFileSync(workerStatePath(), JSON.stringify(state), "utf8");
}

function readWorkerState(): LocalLinkedInWorkerState | null {
	if (!existsSync(workerStatePath())) return null;
	try {
		return JSON.parse(
			readFileSync(workerStatePath(), "utf8"),
		) as LocalLinkedInWorkerState;
	} catch {
		return null;
	}
}

function processIsAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function startBrowser(): Promise<void> {
	const kind = option("--browser", "edge") as BrowserKind;
	if (kind !== "chrome" && kind !== "edge")
		throw new Error("BROWSER_MUST_BE_CHROME_OR_EDGE");
	const port = numberOption("--cdp-port", 9222);
	const profile = profileDirectory();
	const executable = browserExecutable(kind);
	mkdirSync(profile, { recursive: true });
	const child = spawn(
		executable,
		[
			`--remote-debugging-port=${port}`,
			`--user-data-dir=${profile}`,
			"--start-maximized",
			"--no-first-run",
			"--no-default-browser-check",
			"https://www.linkedin.com/feed/",
		],
		{ detached: true, stdio: "ignore", windowsHide: false },
	);
	child.unref();
	writeFileSync(pidPath(), String(child.pid ?? ""), "utf8");
	console.log(
		JSON.stringify({ status: "STARTED", browser: kind, port, profile }),
	);
}

async function stopBrowser(): Promise<void> {
	const path = pidPath();
	if (!existsSync(path)) {
		console.log(JSON.stringify({ status: "NOT_RUNNING" }));
		return;
	}
	const pid = Number(readFileSync(path, "utf8"));
	if (Number.isInteger(pid) && pid > 0) {
		try {
			process.kill(pid);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
	}
	unlinkSync(path);
	console.log(JSON.stringify({ status: "STOPPED" }));
}

async function health(): Promise<void> {
	const adapter = new CdpLinkedInBrowserAdapter(
		numberOption("--cdp-port", 9222),
	);
	const result = await adapter.health();
	const lastResultPath = join(profileDirectory(), "last-result.json");
	const lastResult = existsSync(lastResultPath)
		? JSON.parse(readFileSync(lastResultPath, "utf8"))
		: null;
	console.log(
		JSON.stringify({
			...result,
			executionGate: localLinkedInExecutorGateState(),
			lastResult,
		}),
	);
}

function requireExecutionDatabase(worker: boolean): void {
	assertLocalLinkedInDatabaseAccess({
		databaseUrl: process.env.DATABASE_URL,
		allowDisposableDatabase: process.argv.includes("--allow-disposable-db"),
		worker,
	});
}

function requireRecoveryDatabase(): void {
	if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
	const target = localLinkedInDatabaseTarget(process.env.DATABASE_URL);
	if (!target.isAuthoritative)
		throw new Error("MESSAGE_RECOVERY_REQUIRES_AUTHORITATIVE_CRM");
}

function requireProductionWorkerDatabase(): void {
	if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
	const target = localLinkedInDatabaseTarget(process.env.DATABASE_URL);
	if (!target.isAuthoritative)
		throw new Error("PERSISTENT_WORKER_REQUIRES_AUTHORITATIVE_CRM");
	requireExecutionDatabase(true);
}

function requireActionQueueDatabase(): void {
	if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
	const target = localLinkedInDatabaseTarget(process.env.DATABASE_URL);
	if (!target.isLocal)
		throw new Error("LINKEDIN_ACTION_QUEUE_DATABASE_MUST_BE_LOCAL");
	if (
		!target.isAuthoritative &&
		!process.argv.includes("--allow-disposable-db")
	)
		throw new Error("QUEUE_REQUIRES_ALLOW_DISPOSABLE_DB");
}

async function createExecutor() {
	const { db } = await import("@crm/db");
	const { LinkedInChannelService } = await import("./linkedin-channel.service");
	const service = new LinkedInChannelService(db);
	const core = {
		claimNextConnectionRequestJob: async (
			workerId: string,
			accountKey?: string,
		) => {
			const rows = (await service.claimNextConnectionRequestJob(
				workerId,
				accountKey,
			)) as Array<{
				id: string;
				contactId: string;
				routeId: string;
				profileUrl: string;
				profileIdentifier: string;
			}>;
			return rows[0] ?? null;
		},
		beginConnectionRequestAttempt: (jobId: string, workerId: string) =>
			service.beginConnectionRequestAttempt(jobId, workerId),
		recordConnectionRequestAttempt: (
			input: Parameters<
				LinkedInChannelService["recordConnectionRequestAttempt"]
			>[0],
		) => service.recordConnectionRequestAttempt(input),
		claimNextJob: async (workerId: string) => {
			const rows = (await service.claimNextJob(workerId)) as Array<{
				id: string;
				conversationId: string;
				messageId: string | null;
				action: "MESSAGE";
				status: string;
				attemptCount: number;
			}>;
			return rows[0] ?? null;
		},
		prepareMessageExecution: (jobId: string, workerId: string) =>
			service.prepareMessageExecution(jobId, workerId),
		recordAttempt: (
			input: Parameters<LinkedInChannelService["recordAttempt"]>[0],
		) => service.recordAttempt(input),
	};
	const browser = new CdpLinkedInBrowserAdapter(
		numberOption("--cdp-port", 9222),
	);
	const executor = new LocalLinkedInExecutor(
		core,
		browser,
		option("--worker-id", `atlas-local-${process.pid}`),
		option("--account-key", "default"),
	);
	return { db, browser, executor };
}

async function runOnce(): Promise<void> {
	requireExecutionDatabase(false);
	const { db, executor } = await createExecutor();
	try {
		const result = await executor.runOnce();
		mkdirSync(profileDirectory(), { recursive: true });
		writeFileSync(
			join(profileDirectory(), "last-result.json"),
			JSON.stringify(result),
			"utf8",
		);
		console.log(JSON.stringify(result));
	} finally {
		await db.$disconnect();
	}
}

async function recoverUnsentMessage(): Promise<void> {
	requireRecoveryDatabase();
	const jobId = option("--job-id", "");
	if (!jobId) throw new Error("JOB_ID_REQUIRED");
	const { db } = await import("@crm/db");
	const { LinkedInChannelService } = await import("./linkedin-channel.service");
	try {
		const result = await new LinkedInChannelService(db).recoverUnsentMessage(
			jobId,
			option("--error-code", "MESSAGE_EDITOR_UNAVAILABLE"),
			{
				restoreRoutineState: process.argv.includes("--restore-routine-state"),
				reconcileRoutineState: process.argv.includes(
					"--reconcile-routine-state",
				),
			},
		);
		console.log(JSON.stringify(result));
	} finally {
		await db.$disconnect();
	}
}

async function reconcileDeletedMessage(): Promise<void> {
	requireRecoveryDatabase();
	const jobId = option("--job-id", "");
	const classification = option("--conversation-classification", "");
	if (!jobId) throw new Error("JOB_ID_REQUIRED");
	if (!classification) throw new Error("CONVERSATION_CLASSIFICATION_REQUIRED");
	const { db } = await import("@crm/db");
	const { LinkedInChannelService } = await import("./linkedin-channel.service");
	const parseDate = (name: string): Date | null | undefined => {
		const value = option(name, "");
		if (!value) return undefined;
		const date = new Date(value);
		if (Number.isNaN(date.getTime()))
			throw new Error(`${name.toUpperCase()}_INVALID`);
		return date;
	};
	try {
		const result = await new LinkedInChannelService(
			db,
		).reconcileDeletedOutboundMessage({
			jobId,
			conversationClassification: classification as Parameters<
				LinkedInChannelService["reconcileDeletedOutboundMessage"]
			>[0]["conversationClassification"],
			lastInboundAt: parseDate("--last-inbound-at"),
			lastOutboundAt: parseDate("--last-outbound-at"),
			lastMessageAt: parseDate("--last-message-at"),
			nextActionTitle: option("--next-action-title", "WAIT_FOR_PROSPECT"),
			reason: option("--reason", "EXTERNAL_MESSAGE_DELETED"),
		});
		console.log(JSON.stringify(result));
	} finally {
		await db.$disconnect();
	}
}

async function queueRoutineAction(): Promise<void> {
	requireActionQueueDatabase();
	const raw = option("--input-json", "");
	if (!raw) throw new Error("INPUT_JSON_REQUIRED");
	let input: unknown;
	try {
		input = JSON.parse(raw);
	} catch {
		throw new Error("INPUT_JSON_INVALID");
	}
	const { db } = await import("@crm/db");
	const { LinkedInActionQueueService } = await import(
		"./linkedin-action-queue.service"
	);
	const { LinkedInChannelService } = await import("./linkedin-channel.service");
	const service = new LinkedInActionQueueService(
		db,
		new LinkedInChannelService(db),
	);
	try {
		const result = await service.queueRoutineAction(
			input as LinkedInRoutineActionInput,
		);
		console.log(JSON.stringify(result));
	} finally {
		await db.$disconnect();
	}
}

async function startWorker(): Promise<void> {
	requireProductionWorkerDatabase();
	const pidFile = workerPidPath();
	if (existsSync(pidFile)) {
		const existingPid = Number(readFileSync(pidFile, "utf8"));
		if (processIsAlive(existingPid))
			throw new Error(`LOCAL_LINKEDIN_WORKER_ALREADY_RUNNING:${existingPid}`);
		unlinkSync(pidFile);
	}
	const profile = profileDirectory();
	mkdirSync(profile, { recursive: true });
	if (existsSync(workerStopPath())) unlinkSync(workerStopPath());
	const script = resolve(
		process.argv[1] ?? "src/linkedin/local-linkedin-executor-cli.ts",
	);
	const child = spawn(
		process.execPath,
		[
			script,
			"worker-run",
			"--cdp-port",
			String(numberOption("--cdp-port", 9222)),
			"--poll-ms",
			String(numberOption("--poll-ms", 10_000)),
			"--worker-id",
			option("--worker-id", `atlas-local-worker-${Date.now()}`),
			"--account-key",
			option("--account-key", "default"),
			"--profile",
			profile,
		],
		{ detached: true, stdio: "ignore", windowsHide: true },
	);
	child.unref();
	if (!child.pid) throw new Error("LOCAL_LINKEDIN_WORKER_FAILED_TO_START");
	writeFileSync(pidFile, String(child.pid), "utf8");
	console.log(
		JSON.stringify({
			status: "STARTED",
			pid: child.pid,
			pollMs: numberOption("--poll-ms", 10_000),
			executionGate: localLinkedInExecutorGateState(),
		}),
	);
}

async function runWorker(): Promise<void> {
	requireProductionWorkerDatabase();
	const workerId = option("--worker-id", `atlas-local-worker-${process.pid}`);
	const { db, browser, executor } = await createExecutor();
	const pidFile = workerPidPath();
	writeFileSync(pidFile, String(process.pid), "utf8");
	const worker = new LocalLinkedInWorker(
		executor,
		() => browser.health(),
		workerId,
		numberOption("--poll-ms", 10_000),
		writeWorkerState,
		() => existsSync(workerStopPath()),
		() => localLinkedInExecutorEnabled(),
	);
	try {
		await worker.run();
	} catch (error) {
		writeWorkerState({
			status: "ERROR",
			workerId,
			updatedAt: new Date().toISOString(),
			error: error instanceof Error ? error.message : "WORKER_FAILED",
		});
		throw error;
	} finally {
		await db.$disconnect();
		if (existsSync(pidFile)) unlinkSync(pidFile);
		if (existsSync(workerStopPath())) unlinkSync(workerStopPath());
	}
}

async function stopWorker(): Promise<void> {
	const pidFile = workerPidPath();
	if (!existsSync(pidFile)) {
		console.log(JSON.stringify({ status: "NOT_RUNNING" }));
		return;
	}
	const pid = Number(readFileSync(pidFile, "utf8"));
	if (!processIsAlive(pid)) {
		unlinkSync(pidFile);
		console.log(JSON.stringify({ status: "NOT_RUNNING", stalePid: pid }));
		return;
	}
	mkdirSync(profileDirectory(), { recursive: true });
	writeFileSync(workerStopPath(), "stop", "utf8");
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (!processIsAlive(pid)) {
			console.log(JSON.stringify({ status: "STOPPED", pid }));
			return;
		}
		await wait(250);
	}
	console.log(JSON.stringify({ status: "STOP_REQUESTED", pid }));
}

async function status(): Promise<void> {
	const adapter = new CdpLinkedInBrowserAdapter(
		numberOption("--cdp-port", 9222),
	);
	const browser = await adapter.health();
	const pid = existsSync(workerPidPath())
		? Number(readFileSync(workerPidPath(), "utf8"))
		: null;
	console.log(
		JSON.stringify({
			executionGate: localLinkedInExecutorGateState(),
			browser,
			worker: {
				running: pid !== null && processIsAlive(pid),
				pid,
				state: readWorkerState(),
			},
		}),
	);
}

async function main(): Promise<void> {
	const command = process.argv[2] ?? "health";
	if (command === "start") return startBrowser();
	if (command === "stop") return stopBrowser();
	if (command === "health") return health();
	if (command === "run-once") return runOnce();
	if (command === "recover-unsent-message") return recoverUnsentMessage();
	if (command === "reconcile-deleted-message") return reconcileDeletedMessage();
	if (command === "queue-routine") return queueRoutineAction();
	if (command === "worker") {
		const subcommand = process.argv[3] ?? "status";
		if (subcommand === "start") return startWorker();
		if (subcommand === "stop") return stopWorker();
		if (subcommand === "status") return status();
		throw new Error("WORKER_COMMAND_MUST_BE_START_STOP_OR_STATUS");
	}
	if (command === "worker-run") return runWorker();
	throw new Error(
		"COMMAND_MUST_BE_START_STOP_HEALTH_RUN_ONCE_RECOVER_UNSENT_MESSAGE_RECONCILE_DELETED_MESSAGE_QUEUE_ROUTINE_OR_WORKER",
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
