import { rm, writeFile } from "node:fs/promises";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { MailboxSyncService } from "./sync/mailbox-sync.service";

const logger = new Logger("MailboxWorker");
let stopping = false;

const wait = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function bootstrap() {
	const context = await NestFactory.createApplicationContext(AppModule);
	const sync = context.get(MailboxSyncService);
	const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);
	if (!Number.isFinite(intervalMs) || intervalMs < 1_000) {
		throw new Error("WORKER_INTERVAL_MS must be at least 1000");
	}

	const stop = () => {
		stopping = true;
	};
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
	logger.log({ message: "Mailbox worker ready", intervalMs });
	await writeFile("/tmp/worker-ready", new Date().toISOString());

	while (!stopping) {
		try {
			await sync.runDue();
		} catch (error) {
			logger.error(
				{ message: "Mailbox worker tick failed" },
				error instanceof Error ? error.stack : String(error),
			);
		}
		if (!stopping) await wait(intervalMs);
	}

	await rm("/tmp/worker-ready", { force: true });
	await context.close();
	logger.log({ message: "Mailbox worker stopped" });
}

void bootstrap().catch((error: unknown) => {
	logger.fatal(
		{ message: "Mailbox worker failed to start" },
		error instanceof Error ? error.stack : String(error),
	);
	process.exit(1);
});
