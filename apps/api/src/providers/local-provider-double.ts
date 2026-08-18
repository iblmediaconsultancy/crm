import { createHash } from "node:crypto";
import type { ResendCredentialSource } from "./provider-credentials";
import type { ResendTransport } from "./resend-transport";

export function localProviderDoubleEnabled(): boolean {
	return (
		process.env.NODE_ENV !== "production" &&
		process.env.IBL_LOCAL_PROVIDER_DOUBLE === "enabled"
	);
}

export const localResendCredentialSource: ResendCredentialSource = {
	load: async () => ({ apiKey: "local-provider-double" }),
};

export const localResendTransport: ResendTransport = {
	send: async (_apiKey, message) => ({
		providerMessageId: `local-${createHash("sha256")
			.update(message.idempotencyKey)
			.digest("hex")
			.slice(0, 24)}`,
	}),
};
