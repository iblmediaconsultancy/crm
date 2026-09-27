import { hostname } from "node:os";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { MiabSyncService } from "./providers/miab-sync.service";

const wait = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function bootstrap() {
	const context = await NestFactory.createApplicationContext(AppModule);
	const miab = context.get(MiabSyncService);
	const workerId = `inbound:${hostname()}:${process.pid}`;
	const intervalMs = 300_000;
	let stopping = false;
	const stop = () => {
		stopping = true;
	};

	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);

	while (!stopping) {
		try {
			await miab.runDue(workerId);
		} catch (error) {
			console.error(
				"Inbound mailbox sync failed",
				error instanceof Error ? error.message : String(error),
			);
		}
		if (!stopping) await wait(intervalMs);
	}

	await context.close();
}

void bootstrap().catch((error: unknown) => {
	console.error(
		"Inbound mailbox worker failed to start",
		error instanceof Error ? error.stack : String(error),
	);
	process.exit(1);
});
