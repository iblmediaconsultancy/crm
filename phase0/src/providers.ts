export type ImapMessage = {
	messageId: string;
	inReplyTo?: string;
	references?: string[];
	from: string;
	to: string[];
	subject: string;
	body: string;
};

export interface ImapProbe {
	connectTls(): Promise<void>;
	authenticate(): Promise<void>;
	capabilities(): Promise<string[]>;
	folders(): Promise<string[]>;
	fetchReadOnly(folder: string): Promise<ImapMessage[]>;
	close(): Promise<void>;
}

export async function verifyImapReadOnly(client: ImapProbe) {
	await client.connectTls();
	try {
		await client.authenticate();
		const capabilities = await client.capabilities();
		const folders = await client.folders();
		if (!folders.includes("INBOX")) throw new Error("INBOX not discovered");
		const messages = await client.fetchReadOnly("INBOX");
		return { capabilities, folders, messages: messages.map(normalizeMessage) };
	} finally {
		await client.close();
	}
}

export function normalizeMessage(message: ImapMessage) {
	const root = message.references?.[0] ?? message.inReplyTo ?? message.messageId;
	return {
		providerMessageId: message.messageId,
		threadKey: root.toLowerCase(),
		from: message.from.toLowerCase(),
		to: message.to.map((address) => address.toLowerCase()),
		subject: message.subject.trim(),
		body: message.body,
	};
}

export async function manualResendSend(input: {
	manualApproval: boolean;
	apiKey: string;
	mailbox: { ownerUserId: string; address: string; displayName: string };
	authenticatedUserId: string;
	to: string;
	subject: string;
	text: string;
	idempotencyKey: string;
	fetcher?: typeof fetch;
}) {
	if (!input.manualApproval) throw new Error("manual approval required");
	if (input.mailbox.ownerUserId !== input.authenticatedUserId) throw new Error("sender mailbox mismatch");
	if (!input.idempotencyKey) throw new Error("idempotency key required");
	const response = await (input.fetcher ?? fetch)("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			authorization: `Bearer ${input.apiKey}`,
			"content-type": "application/json",
			"idempotency-key": input.idempotencyKey,
		},
		body: JSON.stringify({
			from: `${input.mailbox.displayName} <${input.mailbox.address}>`,
			to: [input.to],
			subject: input.subject,
			text: input.text,
		}),
	});
	if (!response.ok) throw new Error(`Resend returned ${response.status}`);
	const result = (await response.json()) as { id?: string };
	return { provider: "resend", providerMessageId: result.id ?? null, status: response.status };
}
