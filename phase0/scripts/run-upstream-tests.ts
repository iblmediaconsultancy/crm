const testDatabaseVariable = "PHASE0_TEST_DATABASE_URL";
const testDatabaseUrl = process.env[testDatabaseVariable];
if (!testDatabaseUrl) throw new Error("PHASE0_TEST_DATABASE_URL is required");

const parsed = new URL(testDatabaseUrl);
const databaseName = parsed.pathname.slice(1);
const allowedHosts = new Set([
	"127.0.0.1",
	"localhost",
	"host.docker.internal",
]);
if (!allowedHosts.has(parsed.hostname))
	throw new Error("Phase 0 tests require a local database host");
if (!/^ibl_command_center_v2_phase0_test_[a-z0-9_]+$/.test(databaseName)) {
	throw new Error("Phase 0 test database name is outside the allowlist");
}

const adminUrl = new URL(testDatabaseUrl);
adminUrl.pathname = "/postgres";
process.env.DATABASE_URL = adminUrl.toString();
const { db: adminDb } = await import("../../packages/db/src/client");

const runsArg = process.argv.find((value) => value.startsWith("--runs="));
const runs = Number(runsArg?.split("=")[1] ?? "2");
const targeted = process.argv.includes("--targeted");
if (!Number.isInteger(runs) || runs < 1 || runs > 5)
	throw new Error("--runs must be between 1 and 5");

const childEnv = { ...process.env };
delete childEnv.MICROSOFT_CLIENT_ID;
delete childEnv.MICROSOFT_CLIENT_SECRET;
delete childEnv.MICROSOFT_TENANT_ID;
Object.assign(childEnv, {
	DATABASE_URL: testDatabaseUrl,
	BETTER_AUTH_SECRET: "phase0-test-secret-at-least-32-characters",
	API_URL: "http://localhost:3001",
	APP_URL: "http://localhost:3000",
	ALLOWED_SIGN_IN: "example.test",
	GOOGLE_CLIENT_ID: "phase0-google-client-id",
	GOOGLE_CLIENT_SECRET: "phase0-google-client-secret",
	CRM_TELEMETRY_DISABLED: "1",
	DO_NOT_TRACK: "1",
});

async function command(argv: string[], cwd = process.cwd()) {
	console.log(JSON.stringify({ command: argv, cwd }));
	const child = Bun.spawn(argv, {
		cwd,
		env: childEnv,
		stdout: "inherit",
		stderr: "inherit",
		stdin: "ignore",
	});
	const exitCode = await child.exited;
	if (exitCode !== 0)
		throw new Error(`${argv.join(" ")} failed with ${exitCode}`);
}

async function resetDatabase() {
	await adminDb.$executeRawUnsafe(
		`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
	);
	await adminDb.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
	await adminDb.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
	await command([
		"bunx",
		"prisma",
		"migrate",
		"deploy",
		"--config",
		"packages/db/prisma.config.ts",
	]);
}

const suites = [
	["packages/env", ["bun", "test", "--timeout", "30000", "--reporter", "dots"]],
	["packages/db", ["bun", "test", "--timeout", "30000", "--reporter", "dots"]],
	[
		"packages/auth",
		["bun", "test", "--timeout", "30000", "--reporter", "dots"],
	],
	[
		"packages/telemetry",
		["bun", "test", "--timeout", "30000", "--reporter", "dots"],
	],
	["apps/app", ["bun", "test", "--timeout", "30000", "--reporter", "dots"]],
	[
		"apps/api",
		[
			"bun",
			"test",
			"--timeout",
			"30000",
			"--reporter",
			"dots",
			"--preload",
			"./test/setup.ts",
		],
	],
	["apps/agent", ["bun", "test", "--timeout", "30000", "--reporter", "dots"]],
] as const;

for (let run = 1; run <= runs; run += 1) {
	console.log(
		JSON.stringify({ phase: "deterministic-upstream-suite", run, runs }),
	);
	await resetDatabase();
	for (const [cwd, argv] of suites) await command([...argv], cwd);
}

if (targeted) {
	console.log(JSON.stringify({ phase: "targeted-reruns" }));
	await resetDatabase();
	await command(
		[
			"bun",
			"test",
			"test/auth.e2e.spec.ts",
			"--timeout",
			"30000",
			"--rerun-each",
			"10",
			"--reporter",
			"dots",
		],
		"apps/api",
	);
	await command(
		[
			"bun",
			"test",
			"test/durable-agent-runtime.integration.spec.ts",
			"--timeout",
			"30000",
			"--rerun-each",
			"10",
			"--reporter",
			"dots",
		],
		"apps/agent",
	);
}

console.log(
	JSON.stringify({ status: "PASS", deterministicRuns: runs, targeted }),
);
await adminDb.$disconnect();
