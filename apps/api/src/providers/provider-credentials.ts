import { readFile } from "node:fs/promises";
import { Injectable } from "@nestjs/common";

export type MiabCredentials = {
	host: string;
	port: 993;
	username: string;
	password: string;
};

export interface MiabCredentialSource {
	load(address: string): Promise<MiabCredentials>;
}

export interface ResendCredentialSource {
	load(): Promise<{ apiKey: string }>;
}

@Injectable()
export class EnvironmentMiabCredentialSource implements MiabCredentialSource {
	async load(address: string): Promise<MiabCredentials> {
		const host = process.env.MIAB_IMAP_HOST?.trim();
		const port = Number(process.env.MIAB_IMAP_PORT ?? "993");
		const encoded = await loadSecret(
			"MIAB_MAILBOX_CREDENTIALS_FILE",
			"MIAB_MAILBOX_CREDENTIALS_JSON",
		);
		if (!host || port !== 993 || !encoded) {
			throw new Error("MIAB_CREDENTIALS_UNAVAILABLE");
		}
		let passwords: Record<string, unknown>;
		try {
			passwords = JSON.parse(encoded) as Record<string, unknown>;
		} catch {
			throw new Error("MIAB_CREDENTIALS_INVALID");
		}
		const username = address.trim().toLowerCase();
		const password = passwords[username];
		if (typeof password !== "string" || password.length === 0) {
			throw new Error("MIAB_MAILBOX_CREDENTIAL_UNAVAILABLE");
		}
		return { host, port: 993, username, password };
	}
}

@Injectable()
export class EnvironmentResendCredentialSource
	implements ResendCredentialSource
{
	async load() {
		const apiKey = await loadSecret("RESEND_API_KEY_FILE", "RESEND_API_KEY");
		if (!apiKey) throw new Error("RESEND_CREDENTIAL_UNAVAILABLE");
		return { apiKey };
	}
}

async function loadSecret(
	fileVariable: string,
	inlineVariable: string,
): Promise<string | undefined> {
	const file = process.env[fileVariable]?.trim();
	if (file) {
		const value = (await readFile(file, "utf8")).trim();
		if (!value) throw new Error(`${fileVariable}_EMPTY`);
		return value;
	}
	const inline = process.env[inlineVariable]?.trim();
	if (inline && process.env.NODE_ENV === "production") {
		throw new Error(`${inlineVariable}_FILE_REQUIRED_IN_PRODUCTION`);
	}
	return inline;
}

export function providerErrorCode(error: unknown): string {
	const value = error instanceof Error ? error.message : "UNKNOWN";
	if (/CERT|TLS|SELF_SIGNED|HOSTNAME/i.test(value)) return "TLS_ERROR";
	if (/AUTH|LOGIN|CREDENTIAL|401|403/i.test(value)) return "AUTH_ERROR";
	if (/TIMEOUT|RATE|429/i.test(value)) return "RETRYABLE_PROVIDER_ERROR";
	if (/5\d\d/.test(value)) return "RETRYABLE_PROVIDER_ERROR";
	return "PROVIDER_ERROR";
}
