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
import type { LinkedInChannelService } from "./linkedin-channel.service";
import { LocalLinkedInExecutor } from "./local-linkedin-executor";

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
	console.log(JSON.stringify({ ...result, lastResult }));
}

function requireDisposableDatabase(): void {
	if (!process.argv.includes("--allow-disposable-db"))
		throw new Error("RUN_ONCE_REQUIRES_ALLOW_DISPOSABLE_DB");
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
	const parsed = new URL(databaseUrl);
	if (!/[.:]?(127\.0\.0\.1|localhost)$/i.test(parsed.hostname))
		throw new Error("DISPOSABLE_DATABASE_MUST_BE_LOCAL");
	if (parsed.pathname === "/crm")
		throw new Error("AUTHORITATIVE_CRM_IS_NOT_ALLOWED_FOR_LOCAL_EXECUTOR");
}

async function runOnce(): Promise<void> {
	requireDisposableDatabase();
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
	const executor = new LocalLinkedInExecutor(
		core,
		new CdpLinkedInBrowserAdapter(numberOption("--cdp-port", 9222)),
		option("--worker-id", `atlas-local-${process.pid}`),
		option("--account-key", "default"),
	);
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

async function main(): Promise<void> {
	const command = process.argv[2] ?? "health";
	if (command === "start") return startBrowser();
	if (command === "stop") return stopBrowser();
	if (command === "health") return health();
	if (command === "run-once") return runOnce();
	throw new Error("COMMAND_MUST_BE_START_STOP_HEALTH_OR_RUN_ONCE");
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
