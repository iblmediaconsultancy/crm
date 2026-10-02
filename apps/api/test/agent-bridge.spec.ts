import { afterEach, describe, expect, test } from "bun:test";
import { bridge } from "../src/agent/bridge";

const previousSecret = process.env.AGENT_BRIDGE_SECRET;
const previousUrl = process.env.AGENT_URL;

afterEach(() => {
	if (previousSecret === undefined) delete process.env.AGENT_BRIDGE_SECRET;
	else process.env.AGENT_BRIDGE_SECRET = previousSecret;
	if (previousUrl === undefined) delete process.env.AGENT_URL;
	else process.env.AGENT_URL = previousUrl;
});

describe("API-to-agent bridge configuration", () => {
	test("fails closed when the shared bridge secret is missing", () => {
		delete process.env.AGENT_BRIDGE_SECRET;
		expect(bridge()).toBeNull();
	});

	test("uses the shared secret and IPv4 agent default when configured", () => {
		process.env.AGENT_BRIDGE_SECRET = "shared-test-secret";
		delete process.env.AGENT_URL;
		const configured = bridge();

		expect(configured?.secret).toBe("shared-test-secret");
		expect(configured?.url("/internal/crm/dispatch").origin).toBe(
			"http://127.0.0.1:2000",
		);
	});

	test("trims API-side whitespace before authenticating agent requests", () => {
		process.env.AGENT_BRIDGE_SECRET = "  shared-test-secret  ";
		process.env.AGENT_URL = "http://127.0.0.1:2010";
		const configured = bridge();

		expect(configured?.secret).toBe("shared-test-secret");
		expect(configured?.url("/internal/crm/verify-key").port).toBe("2010");
	});
});
