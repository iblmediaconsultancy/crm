import "@crm/env/load";

import { hostname } from "node:os";
import { db } from "@crm/db";
import { PostgresJobWorkerService } from "./providers/postgres-job-worker.service";
import { EnvironmentResendCredentialSource } from "./providers/provider-credentials";
import { HttpResendTransport } from "./providers/resend-transport";

const confirmationFlag = "--confirm-transactional-password-reset";

async function main() {
	const args = process.argv.slice(2).filter((argument) => argument !== "--");
	const confirmed = args.includes(confirmationFlag);
	const recipients = args.filter((argument) => argument !== confirmationFlag);
	if (!confirmed || recipients.length !== 1) {
		process.stdout.write("PASSWORD_RESET_DELIVERY=INVALID_INVOCATION\n");
		process.exitCode = 2;
		return;
	}
	const worker = new PostgresJobWorkerService(
		db,
		new EnvironmentResendCredentialSource(),
		new HttpResendTransport(),
	);
	let result:
		| "BLOCKED_CAPABILITY"
		| "BLOCKED_CREDENTIAL"
		| "BLOCKED_SENDER"
		| "INVALID_RECIPIENT"
		| "NO_JOB"
		| "DELIVERED"
		| "DELIVERY_FAILED" = "DELIVERY_FAILED";
	try {
		result = await worker.runPasswordResetOnce(
			`${hostname()}:${process.pid}:${crypto.randomUUID()}`,
			recipients[0] ?? "",
		);
	} catch {
		result = "DELIVERY_FAILED";
	} finally {
		await db.$disconnect();
	}
	process.stdout.write(`PASSWORD_RESET_DELIVERY=${result}\n`);
	if (result !== "DELIVERED" && result !== "NO_JOB") process.exitCode = 1;
}

void main().catch(async () => {
	process.stdout.write("PASSWORD_RESET_DELIVERY=DELIVERY_FAILED\n");
	process.exitCode = 1;
	await db.$disconnect();
});
