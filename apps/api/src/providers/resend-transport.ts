export type ResendMessage = {
	from: { address: string; displayName: string };
	to: string;
	subject: string;
	text: string;
	idempotencyKey: string;
};

export interface ResendTransport {
	send(
		apiKey: string,
		message: ResendMessage,
	): Promise<{ providerMessageId: string }>;
}

export class HttpResendTransport implements ResendTransport {
	constructor(private readonly fetcher: typeof fetch = fetch) {}

	async send(apiKey: string, message: ResendMessage) {
		const response = await this.fetcher("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
				"idempotency-key": message.idempotencyKey,
			},
			body: JSON.stringify({
				from: `${message.from.displayName} <${message.from.address}>`,
				to: [message.to],
				subject: message.subject,
				text: message.text,
			}),
		});
		if (!response.ok) throw new Error(`RESEND_${response.status}`);
		const result = (await response.json()) as { id?: unknown };
		if (typeof result.id !== "string" || result.id.length === 0)
			throw new Error("RESEND_INVALID_RESPONSE");
		return { providerMessageId: result.id };
	}
}
