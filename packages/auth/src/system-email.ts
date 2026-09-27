import { createHash } from "node:crypto";
import { db } from "@crm/db";
import { withPrincipal } from "@crm/db/security";

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

export async function enqueueSystemEmail(message: SystemEmail): Promise<void> {
	await withPrincipal(db, { userId: message.actorUserId, kind: "user" }, (tx) =>
		tx.systemEmailJob.upsert({
			where: { idempotencyKey: message.idempotencyKey },
			create: {
				kind: message.kind,
				actorUserId: message.actorUserId,
				recipientEmail: safeAddress(message.to),
				subject: safeHeader(message.subject),
				textBody: message.text,
				idempotencyKey: message.idempotencyKey,
			},
			update: {},
		}),
	);
}
export async function sendSystemEmail(
	message: SystemEmail,
	dependencies: SystemEmailDependencies,
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
