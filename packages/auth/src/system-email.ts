import { createHash } from "node:crypto";
import { db } from "@crm/db";
import { guardProviderOperation } from "@crm/db/security";

export type SystemEmail = {
	actorUserId: string;
	to: string;
	subject: string;
	text: string;
	idempotencyKey: string;
	kind: "INVITATION" | "PASSWORD_RESET";
};

export type SystemEmailDependencies = {
	guard: (actorUserId: string) => Promise<void>;
	credential: () => Promise<string>;
	transport: (
		apiKey: string,
		message: {
			from: string;
			to: string;
			subject: string;
			text: string;
			idempotencyKey: string;
		},
	) => Promise<{ providerMessageId: string }>;
	audit: (input: {
		actorUserId: string;
		kind: SystemEmail["kind"];
		providerMessageId: string;
	}) => Promise<void>;
};

export async function sendSystemEmail(
	message: SystemEmail,
	dependencies: SystemEmailDependencies = productionDependencies,
): Promise<void> {
	await dependencies.guard(message.actorUserId);
	const apiKey = await dependencies.credential();
	const from = systemSender();
	const result = await dependencies.transport(apiKey, {
		from,
		to: safeAddress(message.to),
		subject: safeHeader(message.subject),
		text: message.text,
		idempotencyKey: message.idempotencyKey,
	});
	await dependencies.audit({
		actorUserId: message.actorUserId,
		kind: message.kind,
		providerMessageId: result.providerMessageId,
	});
}

export function stableSystemEmailKey(
	kind: SystemEmail["kind"],
	value: string,
): string {
	return `ibl-system:${kind.toLowerCase()}:${createHash("sha256").update(value).digest("hex")}`;
}

function systemSender(): string {
	const address = safeAddress(process.env.RESEND_SYSTEM_FROM_EMAIL ?? "");
	const name = safeHeader(
		process.env.RESEND_SYSTEM_FROM_NAME?.trim() || "IBL Command Center",
	);
	return `${name} <${address}>`;
}

function safeAddress(value: string): string {
	const address = value.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || /[\r\n]/.test(address)) {
		throw new Error("RESEND_SYSTEM_ADDRESS_INVALID");
	}
	return address;
}

function safeHeader(value: string): string {
	const header = value.trim();
	if (!header || /[\r\n]/.test(header)) {
		throw new Error("RESEND_SYSTEM_HEADER_INVALID");
	}
	return header;
}

const productionDependencies: SystemEmailDependencies = {
	guard: (actorUserId) =>
		guardProviderOperation(db, {
			capability: "RESEND_OUTBOUND",
			actorUserId,
		}),
	credential: async () => {
		const value = process.env.RESEND_API_KEY?.trim();
		if (!value) throw new Error("RESEND_CREDENTIAL_UNAVAILABLE");
		return value;
	},
	transport: async (apiKey, message) => {
		const response = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
				"idempotency-key": message.idempotencyKey,
			},
			body: JSON.stringify({
				from: message.from,
				to: [message.to],
				subject: message.subject,
				text: message.text,
			}),
		});
		if (!response.ok) throw new Error(`RESEND_${response.status}`);
		const body = (await response.json()) as { id?: unknown };
		if (typeof body.id !== "string" || !body.id) {
			throw new Error("RESEND_INVALID_RESPONSE");
		}
		return { providerMessageId: body.id };
	},
	audit: async ({ actorUserId, kind, providerMessageId }) => {
		await db.securityAuditEvent.create({
			data: {
				actorUserId,
				action: "SYSTEM_EMAIL_SENT",
				resourceType: "SystemEmail",
				resourceId: kind,
				outcome: "SENT",
				metadata: { providerMessageId },
			},
		});
	},
};
