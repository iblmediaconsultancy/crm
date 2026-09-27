import type {
	LocalLinkedInExecutor,
	LocalLinkedInExecutorResult,
} from "./local-linkedin-executor";

export type LocalLinkedInBrowserHealth = {
	status: "READY" | "UNAVAILABLE" | "UNAUTHENTICATED" | "CHALLENGE";
	detail: string;
	url: string | null;
	title: string | null;
};

export type LocalLinkedInWorkerStatus =
	| "STARTING"
	| "IDLE"
	| "WAITING_FOR_BROWSER"
	| "NEEDS_IHSAN"
	| "STOPPED"
	| "ERROR";

export type LocalLinkedInWorkerState = {
	status: LocalLinkedInWorkerStatus;
	workerId: string;
	updatedAt: string;
	lastResult?: LocalLinkedInExecutorResult;
	lastSuccessfulAction?: {
		jobId: string;
		action: string;
		completedAt: string;
	};
	browser?: LocalLinkedInBrowserHealth;
	error?: string;
};

type PersistState = (state: LocalLinkedInWorkerState) => void;
type StopRequested = () => boolean;

function now(): string {
	return new Date().toISOString();
}

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shouldStopForResult(result: LocalLinkedInExecutorResult): boolean {
	if (result.status !== "NEEDS_IHSAN") return false;
	return /CAPTCHA|CHALLENGE|UNAUTHENTICATED|RESTRICTION|RATE_LIMIT|SUSPICIOUS/i.test(
		result.reason,
	);
}

export class LocalLinkedInWorker {
	private stopRequested = false;

	constructor(
		private readonly executor: Pick<LocalLinkedInExecutor, "runOnce">,
		private readonly health: () => Promise<LocalLinkedInBrowserHealth>,
		private readonly workerId: string,
		private readonly pollMs: number,
		private readonly persist: PersistState,
		private readonly externalStopRequested: StopRequested = () => false,
		private readonly gateEnabled: StopRequested = () => true,
	) {}

	stop(): void {
		this.stopRequested = true;
	}

	async run(): Promise<LocalLinkedInWorkerState> {
		this.write({ status: "STARTING" });
		while (
			!this.stopRequested &&
			!this.externalStopRequested() &&
			this.gateEnabled()
		) {
			const shouldStop = await this.runCycle();
			if (shouldStop) break;
			await wait(this.pollMs);
		}
		const state = this.write({ status: "STOPPED" });
		return state;
	}

	private async runCycle(): Promise<boolean> {
		let browser: LocalLinkedInBrowserHealth;
		try {
			browser = await this.health();
		} catch (error) {
			this.write({
				status: "WAITING_FOR_BROWSER",
				error: error instanceof Error ? error.message : "BROWSER_HEALTH_FAILED",
			});
			return false;
		}
		if (
			browser.status === "CHALLENGE" ||
			browser.status === "UNAUTHENTICATED"
		) {
			this.write({ status: "NEEDS_IHSAN", browser });
			return true;
		}
		if (browser.status !== "READY") {
			this.write({ status: "WAITING_FOR_BROWSER", browser });
			return false;
		}
		let result: LocalLinkedInExecutorResult;
		try {
			result = await this.executor.runOnce();
		} catch (error) {
			this.write({
				status: "ERROR",
				browser,
				error: error instanceof Error ? error.message : "EXECUTOR_RUN_FAILED",
			});
			return false;
		}
		if (shouldStopForResult(result)) {
			this.write({ status: "NEEDS_IHSAN", browser, lastResult: result });
			return true;
		}
		const lastSuccessfulAction =
			result.status === "COMPLETED"
				? {
						jobId: result.jobId,
						action: result.action,
						completedAt: now(),
					}
				: undefined;
		this.write({
			status: "IDLE",
			browser,
			lastResult: result,
			lastSuccessfulAction,
		});
		return false;
	}

	private write(
		update: Omit<LocalLinkedInWorkerState, "workerId" | "updatedAt">,
	): LocalLinkedInWorkerState {
		const state = { ...update, workerId: this.workerId, updatedAt: now() };
		this.persist(state);
		return state;
	}
}
