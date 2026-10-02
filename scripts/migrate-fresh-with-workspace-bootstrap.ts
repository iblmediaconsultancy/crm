import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const boundaryMigration = "20260803151440_add_workspace_organization";
const repoRoot = path.resolve(import.meta.dir, "..");
const migrationsRoot = path.join(
	repoRoot,
	"packages",
	"db",
	"prisma",
	"migrations",
);
const schemaPath = path.join(
	repoRoot,
	"packages",
	"db",
	"prisma",
	"schema.prisma",
);

if (!process.argv.includes("--fresh"))
	throw new Error("Fresh replay requires the --fresh flag.");
const disposableDatabaseFlag = "ATLAS_DISPOSABLE_DATABASE";
if (process.env[disposableDatabaseFlag] !== "1")
	throw new Error("Fresh replay requires ATLAS_DISPOSABLE_DATABASE=1.");

const connectionString = process.env.DATABASE_MIGRATION_URL?.trim();
if (!connectionString)
	throw new Error("DATABASE_MIGRATION_URL is required for disposable replay.");
const parsedConnection = new URL(connectionString);
const databaseName = decodeURIComponent(
	parsedConnection.pathname.replace(/^\//, ""),
);
if (databaseName === "crm")
	throw new Error(
		"Refusing fresh replay against the authoritative crm database.",
	);
if (
	parsedConnection.hostname !== "127.0.0.1" &&
	parsedConnection.hostname !== "localhost" &&
	parsedConnection.hostname !== "::1"
)
	throw new Error("Fresh replay is limited to a loopback PostgreSQL database.");

const client = new pg.Client({ connectionString });
const workspace = await mkdtemp(path.join(repoRoot, ".tmp-fresh-migration-"));

async function migrationDirectories() {
	const entries = await Array.fromAsync(
		new Bun.Glob("*/migration.sql").scan({
			cwd: migrationsRoot,
			onError: "throw",
		}),
	);
	return entries
		.map((entry) => path.dirname(entry))
		.sort((left, right) => left.localeCompare(right));
}

async function writeConfig(migrationPath: string) {
	const configPath = path.join(
		workspace,
		`${path.basename(migrationPath)}.config.ts`,
	);
	await writeFile(
		configPath,
		[
			'import { defineConfig, env } from "prisma/config";',
			`export default defineConfig({ schema: ${JSON.stringify(schemaPath)}, migrations: { path: ${JSON.stringify(migrationPath)} }, datasource: { url: process.env.DATABASE_MIGRATION_URL ?? env("DATABASE_URL") } });`,
		].join("\n"),
	);
	return configPath;
}

function deploy(configPath: string) {
	execFileSync(
		process.execPath,
		["x", "--bun", "prisma", "migrate", "deploy", "--config", configPath],
		{ cwd: path.join(repoRoot, "packages", "db"), stdio: "inherit" },
	);
}

try {
	await client.connect();
	const existing = await client.query<{ exists: boolean }>(
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations') AS exists`,
	);
	if (existing.rows[0]?.exists) {
		const count = await client.query<{ count: string }>(
			`SELECT COUNT(*)::text AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL`,
		);
		if (Number(count.rows[0]?.count ?? "0") > 0)
			throw new Error(
				"Refusing fresh replay against a database with applied migrations.",
			);
	}
	const directories = await migrationDirectories();
	const boundaryIndex = directories.indexOf(boundaryMigration);
	if (boundaryIndex < 0)
		throw new Error("Workspace migration boundary was not found.");
	const phaseOnePath = path.join(workspace, "phase-one");
	const fullPath = path.join(workspace, "full");
	await Promise.all([
		cp(
			path.join(migrationsRoot, boundaryMigration),
			path.join(phaseOnePath, boundaryMigration),
			{ recursive: true },
		),
		...directories
			.slice(0, boundaryIndex)
			.map((directory) =>
				cp(
					path.join(migrationsRoot, directory),
					path.join(phaseOnePath, directory),
					{ recursive: true },
				),
			),
	]);
	await cp(migrationsRoot, fullPath, { recursive: true });
	deploy(await writeConfig(phaseOnePath));
	await client.query(
		`INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES ('workspace', 'IBL Media Consultancy', 'ibl-media-consultancy', CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING`,
	);
	deploy(await writeConfig(fullPath));
} finally {
	await client.end().catch(() => undefined);
	await rm(workspace, { recursive: true, force: true });
}
