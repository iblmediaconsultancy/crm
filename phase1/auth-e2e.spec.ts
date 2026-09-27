import { describe, expect, test } from "bun:test";
import { auth } from "../packages/auth/src/auth";

const email = process.env.IBL_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.IBL_BOOTSTRAP_ADMIN_PASSWORD;

if (!email || !password) {
	throw new Error("Synthetic bootstrap credentials are required.");
}

describe("invite-only Better Auth foundation", () => {
	test("synthetic bootstrapped Admin can sign in", async () => {
		const response = await auth.api.signInEmail({
			body: { email, password },
			asResponse: true,
		});
		expect(response.status).toBe(200);
	});

	test("public email/password signup is rejected", async () => {
		const response = await auth.api.signUpEmail({
			body: {
				email: "public-signup@local.test",
				password,
				name: "Blocked signup",
			},
			asResponse: true,
		});
		expect(response.status).toBeGreaterThanOrEqual(400);
	});
});
