import { describe, expect, test } from "bun:test";
import {
	type SystemEmailDependencies,
	sendSystemEmail,
	stableSystemEmailKey,
} from "../src/system-email";

const message = {
	actorUserId: "synthetic-user",
	to: "person@example.test",
	subject: "Synthetic reset",
	text: "Synthetic body",
	idempotencyKey: stableSystemEmailKey("PASSWORD_RESET", "synthetic-token"),
	kind: "PASSWORD_RESET" as const,
};

function doubles() {
	const calls: string[] = [];
	const dependencies: SystemEmailDependencies = {
		guard: async () => {
			calls.push("guard");
		},
		credential: async () => {
			calls.push("credential");
			return "synthetic-key";
		},
		transport: async (_key, sent) => {
			calls.push("transport");
			expect(sent.idempotencyKey).toBe(message.idempotencyKey);
			return { providerMessageId: "synthetic-message" };
		},
		audit: async ({ providerMessageId }) => {
			calls.push("audit");
			expect(providerMessageId).toBe("synthetic-message");
		},
	};
	return { calls, dependencies };
}

describe("system Resend delivery", () => {
	test("fails before credentials and network when capability is unavailable", async () => {
		const { calls, dependencies } = doubles();
		dependencies.guard = async () => {
			calls.push("guard");
			throw new Error("UNVERIFIED");
		};
		await expect(sendSystemEmail(message, dependencies)).rejects.toThrow(
			"UNVERIFIED",
		);
		expect(calls).toEqual(["guard"]);
	});

	test("derives sender server-side and delivers once in guarded order", async () => {
		const previousAddress = process.env.RESEND_SYSTEM_FROM_EMAIL;
		const previousName = process.env.RESEND_SYSTEM_FROM_NAME;
		process.env.RESEND_SYSTEM_FROM_EMAIL = "no-reply@example.test";
		process.env.RESEND_SYSTEM_FROM_NAME = "IBL Synthetic";
		try {
			const { calls, dependencies } = doubles();
			await sendSystemEmail(message, dependencies);
			expect(calls).toEqual(["guard", "credential", "transport", "audit"]);
		} finally {
			process.env.RESEND_SYSTEM_FROM_EMAIL = previousAddress;
			process.env.RESEND_SYSTEM_FROM_NAME = previousName;
		}
	});

	test("uses a stable key without exposing the reset token", () => {
		const first = stableSystemEmailKey("PASSWORD_RESET", "secret-token");
		const second = stableSystemEmailKey("PASSWORD_RESET", "secret-token");
		expect(first).toBe(second);
		expect(first).not.toContain("secret-token");
	});
});
