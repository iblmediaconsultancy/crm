import {
	ReadOnlyImapClient,
	requireDedicatedProviderScope,
	requiredProviderEnv,
} from "../src/real-imap";

try {
	requireDedicatedProviderScope();
	const env = requiredProviderEnv([
		"PHASE0_IMAP_HOST",
		"PHASE0_IMAP_USER",
		"PHASE0_IMAP_PASSWORD",
	] as const);
	const portVariable = "PHASE0_IMAP_PORT";
	const port = Number(process.env[portVariable] ?? "993");
	if (port !== 993)
		throw new Error("Phase 0 MIAB preflight requires IMAPS port 993");
	const client = new ReadOnlyImapClient();
	await client.open(env.PHASE0_IMAP_HOST, port);
	try {
		await client.authenticate(env.PHASE0_IMAP_USER, env.PHASE0_IMAP_PASSWORD);
		const evidence = await client.inspectReadOnly();
		const runId = crypto.randomUUID();
		console.log(
			JSON.stringify({
				status: "PASS",
				runId,
				tlsVerified: true,
				authenticated: true,
				mailbox: env.PHASE0_IMAP_USER,
				...evidence,
			}),
		);
	} finally {
		await client.close();
	}
} catch (error) {
	console.error(
		JSON.stringify({
			status: "BLOCKED",
			error: error instanceof Error ? error.message : String(error),
		}),
	);
	process.exit(2);
}
