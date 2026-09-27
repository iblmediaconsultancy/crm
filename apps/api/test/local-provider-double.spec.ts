import { afterEach, describe, expect, test } from "bun:test";
import {
	localProviderDoubleEnabled,
	localResendTransport,
} from "../src/providers/local-provider-double";

const previousNodeEnv = process.env.NODE_ENV;
const previousDouble = process.env.IBL_LOCAL_PROVIDER_DOUBLE;

afterEach(() => {
	if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
	else process.env.NODE_ENV = previousNodeEnv;
	if (previousDouble === undefined)
		delete process.env.IBL_LOCAL_PROVIDER_DOUBLE;
	else process.env.IBL_LOCAL_PROVIDER_DOUBLE = previousDouble;
});

describe("local outreach provider double", () => {
	test("is opt-in outside production", () => {
		process.env.NODE_ENV = "development";
		delete process.env.IBL_LOCAL_PROVIDER_DOUBLE;
		expect(localProviderDoubleEnabled()).toBe(false);
		process.env.IBL_LOCAL_PROVIDER_DOUBLE = "enabled";
		expect(localProviderDoubleEnabled()).toBe(true);
	});

	test("cannot activate in production", () => {
		process.env.NODE_ENV = "production";
		process.env.IBL_LOCAL_PROVIDER_DOUBLE = "enabled";
		expect(localProviderDoubleEnabled()).toBe(false);
	});

	test("returns a deterministic local id without network access", async () => {
		const message = {
			from: { address: "sender@local.test", displayName: "Sender" },
			to: "lead@local.test",
			subject: "Local acceptance",
			text: "Disposable body",
			idempotencyKey: "outreach-local-test",
		};
		const first = await localResendTransport.send("unused", message);
		const second = await localResendTransport.send("unused", message);
		expect(first.providerMessageId).toBe(second.providerMessageId);
		expect(first.providerMessageId.startsWith("local-")).toBe(true);
	});
});
