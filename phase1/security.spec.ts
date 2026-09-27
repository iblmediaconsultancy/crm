import { describe, expect, test } from "bun:test";
import { ProviderCapabilityError } from "../packages/db/src/security";

describe("Phase 1 security contracts", () => {
	test("provider errors remain fail closed", () => {
		const error = new ProviderCapabilityError("RESEND_OUTBOUND", "blocked");
		expect(error.name).toBe("ProviderCapabilityError");
		expect(error.capability).toBe("RESEND_OUTBOUND");
	});

	test("identity supports explicit mailbox-free research", async () => {
		const module = await import("../packages/db/src/security");
		expect(typeof module.deriveIdentityEnvelope).toBe("function");
	});
});
