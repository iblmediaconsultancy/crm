import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");
async function sourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return sourceFiles(path);
			return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
		}),
	);
	return nested.flat();
}

describe("production runtime boundaries", () => {
	test("API and worker source graphs contain no quarantined provider or Redis coordination imports", async () => {
		const files = await sourceFiles(join(root, "apps", "api", "src"));
		const violations: string[] = [];
		for (const file of files) {
			if (file.includes(join("src", "generated"))) continue;
			const source = await readFile(file, "utf8");
			if (
				/from\s+["'][^"']*(?:google|microsoft|redis|ioredis)[^"']*["']/i.test(
					source,
				)
			) {
				violations.push(file);
			}
		}
		expect(violations).toEqual([]);
	});

	test("production Compose has PostgreSQL coordination and no Redis service or variable", async () => {
		const compose = await readFile(
			join(root, "phase7", "docker-compose.yml"),
			"utf8",
		);
		expect(compose).not.toMatch(/(?:^|\n)\s*redis\s*:/i);
		expect(compose).not.toMatch(/REDIS_URL|ioredis/i);
		expect(compose).toContain("${POSTGRES_17_IMAGE:");
		expect(compose).not.toMatch(/(?:^|\n)\s*build\s*:/);
		expect(compose).toContain("${IBL_WORKER_IMAGE:");
	});

	test("sending credentials are mounted only on the worker", async () => {
		const compose = await readFile(
			join(root, "phase7", "docker-compose.yml"),
			"utf8",
		);
		const api = compose.match(/\n  api:[\s\S]*?\n  worker:/)?.[0] ?? "";
		const worker = compose.match(/\n  worker:[\s\S]*?\n  agent:/)?.[0] ?? "";
		expect(api).not.toContain("miab_mailbox_credentials_json");
		expect(api).not.toContain("resend_api_key");
		expect(api).toContain("resend_webhook_secret");
		expect(worker).toContain("miab_mailbox_credentials_json");
		expect(worker).toContain("resend_api_key");
	});

	test("every permission-declaring router attaches authentication and permission enforcement", async () => {
		const files = await sourceFiles(join(root, "apps", "api", "src"));
		const violations: string[] = [];
		for (const file of files.filter((candidate) =>
			candidate.endsWith(".router.ts"),
		)) {
			const source = await readFile(file, "utf8");
			if (!source.includes("meta: { permission:")) continue;
			if (
				!source.includes(
					"@UseMiddlewares(AuthMiddleware, PermissionMiddleware)",
				)
			) {
				violations.push(file);
			}
		}
		expect(violations).toEqual([]);
	});
	test("PostgreSQL worker claims recover expired leases without Redis", async () => {
		const source = await readFile(
			join(
				root,
				"apps",
				"api",
				"src",
				"providers",
				"postgres-job-worker.service.ts",
			),
			"utf8",
		);
		expect(source).toContain("'PENDING', 'FAILED', 'LEASED'");
		expect(source).toContain("FOR UPDATE SKIP LOCKED");
		expect(source).toContain('"leasedUntil" IS NULL OR "leasedUntil" <= NOW()');
		expect(source).not.toMatch(/redis|ioredis/i);
	});
});
