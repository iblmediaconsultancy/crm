import { rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AllocationService } from "./operations/allocation.service";
import { AttachmentStorageService } from "./providers/attachment-storage.service";
import { MiabSyncService } from "./providers/miab-sync.service";
import { PostgresJobWorkerService } from "./providers/postgres-job-worker.service";
import { OutreachLifecycleService } from "./providers/outreach-lifecycle.service";

const logger = new Logger("PostgresWorker");
let stopping = false;

const wait = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function bootstrap() {
	const context = await NestFactory.createApplicationContext(AppModule);
	const miab = context.get(MiabSyncService);
	const attachments = context.get(AttachmentStorageService);
	const allocation = context.get(AllocationService);
	const jobs = context.get(PostgresJobWorkerService);
	const outreach = context.get(OutreachLifecycleService);
	const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 5_000);
	if (!Number.isFinite(intervalMs) || intervalMs < 1_000) {
		throw new Error("WORKER_INTERVAL_MS must be at least 1000");
	}
	const workerId = hostname() + ":" + process.pid + ":" + crypto.randomUUID();
	const stop = () => {
		stopping = true;
	};
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
	logger.log({ message: "PostgreSQL worker ready", intervalMs, workerId });
	await writeFile("/tmp/worker-ready", new Date().toISOString());

	while (!stopping) {
		try {
			const jobsProcessed = await jobs.runDue(workerId);
			const allocationsProcessed = await allocation.runDue(workerId);
			const followUpsProcessed = await outreach.runDue(workerId);
			const attachmentsProcessed = await attachments.runDue(workerId);
			const mailboxesProcessed = await miab.runDue(workerId);
			logger.debug({
				message: "Worker tick",
				jobsProcessed,
				allocationsProcessed,
				followUpsProcessed,
				attachmentsProcessed,
				mailboxesProcessed,
			});
		} catch (error) {
			logger.error(
				{ message: "PostgreSQL worker tick failed" },
				error instanceof Error ? error.stack : String(error),
			);
		}
		if (!stopping) await wait(intervalMs);
	}

	await rm("/tmp/worker-ready", { force: true });
	await context.close();
	logger.log({ message: "PostgreSQL worker stopped" });
}

void bootstrap().catch((error: unknown) => {
	logger.fatal(
		{ message: "PostgreSQL worker failed to start" },
		error instanceof Error ? error.stack : String(error),
	);
	process.exit(1);
});
