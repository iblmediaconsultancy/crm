import { manualResendSend } from "../src/providers";
import {
	parseSender,
	quoteImap,
	ReadOnlyImapClient,
	requireDedicatedProviderScope,
	requiredProviderEnv,
} from "../src/real-imap";

const runId = process.argv
	.find((value) => value.startsWith("--preflight-run-id="))
	?.split("=")[1];
const approvedRunId = process.argv
	.find((value) => value.startsWith("--approve-one-send="))
	?.split("=")[1];

const approvalVariable = "PHASE0_SEND_APPROVAL";
if (
	!runId ||
	!/^[0-9a-f-]{36}$/i.test(runId) ||
	approvedRunId !== runId ||
	process.env[approvalVariable] !== "APPROVED_ONCE"
) {
	console.error(
		JSON.stringify({
			status: "BLOCKED",
			error:
				"matching preflight run ID and explicit one-send approval are required",
		}),
	);
	process.exit(2);
}

try {
	requireDedicatedProviderScope();
	const env = requiredProviderEnv([
		"PHASE0_IMAP_HOST",
		"PHASE0_IMAP_USER",
		"PHASE0_IMAP_PASSWORD",
		"PHASE0_RESEND_API_KEY",
		"PHASE0_RESEND_FROM",
		"PHASE0_RESEND_TO",
	] as const);
	if (
		env.PHASE0_RESEND_TO.toLowerCase() !== env.PHASE0_IMAP_USER.toLowerCase()
	) {
		throw new Error("PHASE0_RESEND_TO must equal PHASE0_IMAP_USER");
	}
	const portVariable = "PHASE0_IMAP_PORT";
	const port = Number(process.env[portVariable] ?? "993");
	if (port !== 993)
		throw new Error("Phase 0 MIAB proof requires IMAPS port 993");
	const sender = parseSender(env.PHASE0_RESEND_FROM);
	const client = new ReadOnlyImapClient();
	await client.open(env.PHASE0_IMAP_HOST, port);
	try {
		await client.authenticate(env.PHASE0_IMAP_USER, env.PHASE0_IMAP_PASSWORD);
		await client.command("CAPABILITY");
		await client.command('LIST "" "*"');
		await client.command("EXAMINE INBOX");
		const subject = `IBL Phase 0 provider proof ${runId}`;
		const result = await manualResendSend({
			manualApproval: true,
			apiKey: env.PHASE0_RESEND_API_KEY,
			mailbox: {
				ownerUserId: "phase0-provider-user",
				address: sender.address,
				displayName: sender.displayName,
			},
			authenticatedUserId: "phase0-provider-user",
			to: env.PHASE0_RESEND_TO,
			subject,
			text: "Dedicated non-production IBL Phase 0 delivery proof.",
			idempotencyKey: `ibl-phase0/provider/${runId}`,
		});
		let receivedReadOnly = false;
		for (let attempt = 0; attempt < 12 && !receivedReadOnly; attempt += 1) {
			await Bun.sleep(5_000);
			const search = await client.command(
				`UID SEARCH HEADER SUBJECT ${quoteImap(subject)}`,
			);
			const ids = search.match(/\* SEARCH ([0-9 ]+)/)?.[1]?.trim();
			const latest = ids?.split(/\s+/).at(-1);
			if (latest) {
				const fetched = await client.command(
					`UID FETCH ${latest} (BODY.PEEK[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES FROM TO SUBJECT)] BODY.PEEK[TEXT]<0.2048>)`,
				);
				receivedReadOnly = fetched.includes(subject);
			}
		}
		console.log(
			JSON.stringify({
				status: receivedReadOnly ? "PASS" : "FAIL",
				runId,
				oneSendRequested: true,
				idempotencyKey: `ibl-phase0/provider/${runId}`,
				resendStatus: result.status,
				providerMessageIdRecorded: Boolean(result.providerMessageId),
				receivedReadOnly,
			}),
		);
		if (!receivedReadOnly) process.exitCode = 1;
	} finally {
		await client.close();
	}
} catch (error) {
	console.error(
		JSON.stringify({
			status: "FAIL",
			runId,
			error: error instanceof Error ? error.message : String(error),
		}),
	);
	process.exit(1);
}
