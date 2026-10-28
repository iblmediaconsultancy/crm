import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvironmentResendCredentialSource } from "../src/providers/provider-credentials";

const previousNodeEnv = process.env.NODE_ENV;
const previousCredentialFile = process.env.RESEND_API_KEY_FILE;
const previousInlineCredential = process.env.RESEND_API_KEY;
const temporaryDirectories: string[] = [];

afterEach(async () => {
	if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
	else process.env.NODE_ENV = previousNodeEnv;
	if (previousCredentialFile === undefined)
		delete process.env.RESEND_API_KEY_FILE;
	else process.env.RESEND_API_KEY_FILE = previousCredentialFile;
	if (previousInlineCredential === undefined) delete process.env.RESEND_API_KEY;
	else process.env.RESEND_API_KEY = previousInlineCredential;
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("Resend credential file source", () => {
	test("loads the production credential from the configured file", async () => {
		const directory = await mkdtemp(join(tmpdir(), "atlas-resend-test-"));
		temporaryDirectories.push(directory);
		const file = join(directory, "resend-key");
		await writeFile(file, "synthetic-file-key\n", { mode: 0o600 });
		process.env.NODE_ENV = "production";
		process.env.RESEND_API_KEY_FILE = file;
		delete process.env.RESEND_API_KEY;
		const loaded = await new EnvironmentResendCredentialSource().load();
		expect(loaded.apiKey).toBe("synthetic-file-key");
	});

	test("rejects inline credentials in production when no file is configured", async () => {
		process.env.NODE_ENV = "production";
		delete process.env.RESEND_API_KEY_FILE;
		process.env.RESEND_API_KEY = "synthetic-inline-key";
		await expect(
			new EnvironmentResendCredentialSource().load(),
		).rejects.toThrow("RESEND_API_KEY_FILE_REQUIRED_IN_PRODUCTION");
	});
});
