import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import {
	canonicalJson,
	type ExportRow,
	type MigrationOutcome,
	planRows,
	stableHash,
	summarize,
} from "./core";

const { Client } = pg;
const root = resolve(import.meta.dir, "..");
const artifactsRoot = resolve(root, "artifacts");
const command = process.argv[2];
const confirmApply = process.argv.includes("--confirm-apply");

const required = (name: string) => {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
};

const safeIdentifier = (value: string) => {
	if (!/^[a-z_][a-z0-9_]*$/i.test(value))
		throw new Error("Unsafe SQL identifier");
	return `"${value.replaceAll('"', '""')}"`;
};

const sha256 = (content: string | Uint8Array) =>
	createHash("sha256").update(content).digest("hex");
const writeJson = async (path: string, value: unknown) =>
	writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });

const connect = async (connectionString: string) => {
	const client = new Client({
		connectionString,
		application_name: "ibl-v1-v2-migration",
	});
	await client.connect();
	return client;
};

const inventorySource = async () => {
	const client = await connect(required("V1_DATABASE_URL"));
	try {
		await client.query(
			"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
		);
		const tables = await client.query(
			"SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
		);
		const columns = await client.query(
			"SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
		);
		const policies = await client.query(
			"SELECT tablename, policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname",
		);
		const extensions = await client.query(
			"SELECT extname, extversion FROM pg_extension ORDER BY extname",
		);
		const migrations = await client.query(
			"SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
		);
		const watermark = await client.query(
			"SELECT txid_current()::text AS transaction_id, statement_timestamp()::text AS captured_at",
		);
		const counts: Record<string, number> = {};
		for (const { tablename } of tables.rows as Array<{ tablename: string }>) {
			const result = await client.query(
				`SELECT count(*)::int AS count FROM public.${safeIdentifier(tablename)}`,
			);
			counts[tablename] = result.rows[0].count;
		}
		await client.query("COMMIT");
		return {
			formatVersion: 1,
			sourceSystem: "ibl-v1-development-supabase",
			watermark: watermark.rows[0],
			tables: tables.rows,
			columns: columns.rows,
			policies: policies.rows,
			extensions: extensions.rows,
			migrations: migrations.rows,
			counts,
		};
	} catch (error) {
		await client.query("ROLLBACK").catch(() => undefined);
		throw error;
	} finally {
		await client.end();
	}
};

const inventory = async () => {
	await mkdir(artifactsRoot, { recursive: true });
	const value = await inventorySource();
	const checksum = sha256(canonicalJson(value));
	const result = { ...value, checksum };
	await writeJson(resolve(artifactsRoot, "inventory.json"), result);
	console.log(
		JSON.stringify(
			{
				tables: value.tables.length,
				rows: Object.values(value.counts).reduce(
					(sum, count) => sum + count,
					0,
				),
				migrations: value.migrations.length,
				policies: value.policies.length,
				extensions: value.extensions.length,
				checksum,
			},
			null,
			2,
		),
	);
};

const exportSource = async () => {
	await mkdir(artifactsRoot, { recursive: true });
	const client = await connect(required("V1_DATABASE_URL"));
	try {
		await client.query(
			"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
		);
		const watermark = (
			await client.query(
				"SELECT txid_current()::text AS transaction_id, statement_timestamp()::text AS captured_at",
			)
		).rows[0];
		const tables = (
			await client.query(
				"SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
			)
		).rows as Array<{ tablename: string }>;
		const files = [] as Array<{
			table: string;
			file: string;
			rowCount: number;
			checksum: string;
		}>;
		for (const { tablename } of tables) {
			const result = await client.query(
				`SELECT * FROM public.${safeIdentifier(tablename)} ORDER BY 1`,
			);
			const content =
				result.rows.map((row) => JSON.stringify(row)).join("\n") +
				(result.rows.length ? "\n" : "");
			const file = `${tablename}.jsonl`;
			await writeFile(resolve(artifactsRoot, file), content, { mode: 0o600 });
			files.push({
				table: tablename,
				file,
				rowCount: result.rows.length,
				checksum: sha256(content),
			});
		}
		await client.query("COMMIT");
		const manifestBase = {
			formatVersion: 1,
			sourceSystem: "ibl-v1-development-supabase",
			watermark,
			files,
		};
		const manifest = {
			...manifestBase,
			checksum: sha256(canonicalJson(manifestBase)),
		};
		await writeJson(resolve(artifactsRoot, "export-manifest.json"), manifest);
		console.log(
			JSON.stringify(
				{
					tables: files.length,
					rows: files.reduce((sum, item) => sum + item.rowCount, 0),
					watermark,
					checksum: manifest.checksum,
				},
				null,
				2,
			),
		);
	} catch (error) {
		await client.query("ROLLBACK").catch(() => undefined);
		throw error;
	} finally {
		await client.end();
	}
};

interface ExportManifest {
	sourceSystem: string;
	watermark: { transaction_id: string; captured_at: string };
	files: Array<{
		table: string;
		file: string;
		rowCount: number;
		checksum: string;
	}>;
	checksum: string;
}

const loadExport = async () => {
	const manifest = JSON.parse(
		await readFile(resolve(artifactsRoot, "export-manifest.json"), "utf8"),
	) as ExportManifest;
	const rows: ExportRow[] = [];
	for (const entry of manifest.files) {
		const content = await readFile(resolve(artifactsRoot, entry.file), "utf8");
		if (sha256(content) !== entry.checksum)
			throw new Error(`Checksum mismatch for ${entry.file}`);
		const records = content.trim()
			? content
					.trimEnd()
					.split("\n")
					.map((line) => JSON.parse(line) as Record<string, unknown>)
			: [];
		if (records.length !== entry.rowCount)
			throw new Error(`Row count mismatch for ${entry.file}`);
		rows.push(...records.map((row) => ({ table: entry.table, row })));
	}
	return { manifest, rows };
};

const plan = async () => {
	const { manifest, rows } = await loadExport();
	const outcomes = planRows(rows, {
		ownerUserId: required("V2_OWNER_USER_ID"),
	});
	const summary = summarize(outcomes);
	const privatePlan = {
		formatVersion: 1,
		sourceManifestChecksum: manifest.checksum,
		sourceWatermark: manifest.watermark,
		outcomes,
	};
	await writeJson(resolve(artifactsRoot, "plan.private.json"), privatePlan);
	const report = {
		formatVersion: 1,
		sourceManifestChecksum: manifest.checksum,
		sourceWatermark: manifest.watermark,
		...summary,
		zeroUnexplainedLoss:
			summary.total === rows.length && summary.accounted === rows.length,
		outcomes: outcomes.map(({ payload: _payload, ...safe }) => safe),
	};
	await writeJson(resolve(artifactsRoot, "reconciliation.json"), report);
	console.log(
		JSON.stringify(
			{ ...summary, zeroUnexplainedLoss: report.zeroUnexplainedLoss },
			null,
			2,
		),
	);
};

const insertMapped = async (client: pg.Client, outcome: MigrationOutcome) => {
	const p = outcome.payload ?? {};
	if (outcome.targetTable === "lead") {
		await client.query(
			`INSERT INTO "lead" ("id","name","status","ownerUserId","createdByUserId","source","sourceKey","nextActionAt","createdAt","updatedAt") VALUES ($1,$2,$3::"LeadStatus",$4,$5,$6::"RecordSource",$7,$8,NOW(),NOW()) ON CONFLICT ("sourceKey") DO NOTHING`,
			[
				outcome.targetId,
				p.name,
				p.status,
				p.ownerUserId,
				p.createdByUserId,
				p.source,
				p.sourceKey,
				p.nextActionAt,
			],
		);
	} else if (outcome.targetTable === "template") {
		await client.query(
			`INSERT INTO "template" ("id","name","kind","body","active","ownerUserId","sourceKey","createdAt","updatedAt") VALUES ($1,$2,$3::"TemplateKind",$4,$5,$6,$7,NOW(),NOW()) ON CONFLICT ("sourceKey") DO NOTHING`,
			[
				outcome.targetId,
				p.name,
				p.kind,
				p.body,
				p.active,
				p.ownerUserId,
				p.sourceKey,
			],
		);
	} else if (outcome.targetTable === "proofItem") {
		await client.query(
			`INSERT INTO "proofItem" ("id","label","proofType","reference","sourceKey","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW(),NOW()) ON CONFLICT ("sourceKey") DO NOTHING`,
			[outcome.targetId, p.label, p.proofType, p.reference, p.sourceKey],
		);
	} else if (outcome.targetTable === "company") {
		await client.query(
			`INSERT INTO "company" ("id","name","country","ownerId","source","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5::"RecordSource",NOW(),NOW()) ON CONFLICT ("id") DO NOTHING`,
			[outcome.targetId, p.name, p.country, p.ownerId, p.source],
		);
	} else if (outcome.targetTable === "contact") {
		await client.query(
			`INSERT INTO "contact" ("id","firstName","lastName","ownerId","source","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5::"RecordSource",NOW(),NOW()) ON CONFLICT ("id") DO NOTHING`,
			[outcome.targetId, p.firstName, p.lastName, p.ownerId, p.source],
		);
	} else {
		throw new Error(`Unsupported target table: ${outcome.targetTable}`);
	}
};

const apply = async () => {
	if (!confirmApply)
		throw new Error(
			"Apply requires --confirm-apply after reviewing reconciliation.json",
		);
	const planDocument = JSON.parse(
		await readFile(resolve(artifactsRoot, "plan.private.json"), "utf8"),
	) as {
		sourceManifestChecksum: string;
		sourceWatermark: { transaction_id: string };
		outcomes: MigrationOutcome[];
	};
	const ownerUserId = required("V2_OWNER_USER_ID");
	const client = await connect(required("DATABASE_URL"));
	const runId = `v1_apply_${stableHash(`${planDocument.sourceManifestChecksum}:${ownerUserId}`).slice(0, 24)}`;
	try {
		await client.query("BEGIN");
		if (
			(await client.query('SELECT 1 FROM "user" WHERE id = $1', [ownerUserId]))
				.rowCount !== 1
		)
			throw new Error("V2_OWNER_USER_ID does not exist");
		await client.query(
			`INSERT INTO "legacyMigrationRun" ("id","sourceSystem","sourceWatermark","manifestChecksum","mode","status") VALUES ($1,'ibl-v1-development-supabase',$2,$3,'APPLY','RUNNING') ON CONFLICT ("id") DO UPDATE SET "status"='RUNNING', "completedAt"=NULL`,
			[
				runId,
				planDocument.sourceWatermark.transaction_id,
				planDocument.sourceManifestChecksum,
			],
		);
		for (const outcome of planDocument.outcomes) {
			const already = await client.query(
				'SELECT 1 FROM "legacyMigrationOutcome" WHERE "idempotencyKey"=$1',
				[outcome.idempotencyKey],
			);
			if (already.rowCount) continue;
			let inserted = false;
			if (
				outcome.outcome === "MAPPED" &&
				outcome.targetTable &&
				outcome.targetId
			) {
				const exists = await client.query(
					`SELECT 1 FROM ${safeIdentifier(outcome.targetTable)} WHERE id=$1`,
					[outcome.targetId],
				);
				await insertMapped(client, outcome);
				inserted = exists.rowCount === 0;
				await client.query(
					`INSERT INTO "legacyIdMap" ("idempotencyKey","sourceTable","sourceIdHash","targetTable","targetId") VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
					[
						outcome.idempotencyKey,
						outcome.sourceTable,
						outcome.sourceIdHash,
						outcome.targetTable,
						outcome.targetId,
					],
				);
				if (inserted)
					await client.query(
						`INSERT INTO "legacyRollbackEntry" ("runId","targetTable","targetId","operation") VALUES ($1,$2,$3,'DELETE_INSERTED_ROW')`,
						[runId, outcome.targetTable, outcome.targetId],
					);
			}
			await client.query(
				`INSERT INTO "legacyMigrationOutcome" ("idempotencyKey","runId","sourceTable","sourceIdHash","outcome","targetTable","targetId","reasonCode") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
				[
					outcome.idempotencyKey,
					runId,
					outcome.sourceTable,
					outcome.sourceIdHash,
					outcome.outcome,
					outcome.targetTable ?? null,
					outcome.targetId ?? null,
					outcome.reasonCode ?? null,
				],
			);
		}
		const report = summarize(planDocument.outcomes);
		await client.query(
			`UPDATE "legacyMigrationRun" SET "status"='COMPLETED', "completedAt"=NOW(), "report"=$2::jsonb WHERE "id"=$1`,
			[runId, JSON.stringify(report)],
		);
		await client.query("COMMIT");
		console.log(JSON.stringify({ runId, ...report }, null, 2));
	} catch (error) {
		await client.query("ROLLBACK").catch(() => undefined);
		throw error;
	} finally {
		await client.end();
	}
};

const reconcile = async () => {
	const { manifest, rows } = await loadExport();
	const report = JSON.parse(
		await readFile(resolve(artifactsRoot, "reconciliation.json"), "utf8"),
	) as { total: number; accounted: number; sourceManifestChecksum: string };
	const checks = {
		manifestChecksumMatches:
			report.sourceManifestChecksum === manifest.checksum,
		sourceRows: rows.length,
		outcomes: report.total,
		accounted: report.accounted,
		zeroUnexplainedLoss:
			rows.length === report.total && report.total === report.accounted,
	};
	console.log(JSON.stringify(checks, null, 2));
	if (
		!Object.values(checks).every(
			(value) => value === true || typeof value === "number",
		)
	)
		process.exitCode = 1;
};

const rollback = async () => {
	if (!confirmApply) throw new Error("Rollback requires --confirm-apply");
	const client = await connect(required("DATABASE_URL"));
	const runId = required("V1_MIGRATION_RUN_ID");
	const allowed = new Set([
		"lead",
		"template",
		"proofItem",
		"company",
		"contact",
	]);
	try {
		await client.query("BEGIN");
		const entries = (
			await client.query(
				`SELECT "sequence","targetTable","targetId" FROM "legacyRollbackEntry" WHERE "runId"=$1 AND "rolledBackAt" IS NULL ORDER BY "sequence" DESC`,
				[runId],
			)
		).rows;
		for (const entry of entries) {
			if (!allowed.has(entry.targetTable))
				throw new Error("Rollback target is not allowlisted");
			await client.query(
				`DELETE FROM ${safeIdentifier(entry.targetTable)} WHERE id=$1`,
				[entry.targetId],
			);
			await client.query(
				`UPDATE "legacyRollbackEntry" SET "rolledBackAt"=NOW() WHERE "runId"=$1 AND "sequence"=$2`,
				[runId, entry.sequence],
			);
		}
		await client.query(
			`DELETE FROM "legacyIdMap" m USING "legacyMigrationOutcome" o WHERE o."runId"=$1 AND m."idempotencyKey"=o."idempotencyKey"`,
			[runId],
		);
		await client.query(
			`DELETE FROM "legacyMigrationOutcome" WHERE "runId"=$1`,
			[runId],
		);
		await client.query(
			`UPDATE "legacyMigrationRun" SET "status"='ROLLED_BACK', "completedAt"=NOW() WHERE "id"=$1`,
			[runId],
		);
		await client.query("COMMIT");
		console.log(JSON.stringify({ runId, rolledBack: entries.length }, null, 2));
	} catch (error) {
		await client.query("ROLLBACK").catch(() => undefined);
		throw error;
	} finally {
		await client.end();
	}
};

const commands: Record<string, () => Promise<void>> = {
	inventory,
	export: exportSource,
	plan,
	apply,
	reconcile,
	rollback,
};
if (!command || !commands[command])
	throw new Error(`Unknown command: ${command ?? "<missing>"}`);
await commands[command]();
