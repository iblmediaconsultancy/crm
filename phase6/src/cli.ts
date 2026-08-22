import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import {
	canonicalJson,
	type ExportRow,
	type MigrationOutcome,
	planRows,
	sourceIdentity,
	stableHash,
	summarize,
	targetIdForTest as targetIdFor,
} from "./core";
import { businessV1Rows } from "../fixtures/business-v1";
import { orderMigrationOutcomes } from "./apply-order";

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

type ClassificationState =
	| "MAPPED"
	| "PLATFORM_INTERNAL"
	| "INTENTIONALLY_EXCLUDED"
	| "AWAITING_OWNER_DECISION";
type SourceClassification = {
	formatVersion: 1;
	inventoryChecksum: string;
	tables: Record<string, {
		classification: ClassificationState;
		rationale: string;
		fields: Record<string, ClassificationState>;
	}>;
};

const classify = async () => {
	const inventoryDocument = JSON.parse(
		await readFile(resolve(artifactsRoot, "inventory.json"), "utf8"),
	) as {
		checksum: string;
		tables: Array<{ tablename: string }>;
		columns: Array<{ table_name: string; column_name: string }>;
	};
	const existing = await readFile(
		resolve(artifactsRoot, "source-classification.json"),
		"utf8",
	).then((value) => JSON.parse(value) as SourceClassification).catch(() => null);
	const tables: SourceClassification["tables"] = {};
	for (const { tablename } of inventoryDocument.tables) {
		const prior = existing?.tables[tablename];
		const fields: Record<string, ClassificationState> = {};
		for (const column of inventoryDocument.columns.filter(
			(item) => item.table_name === tablename,
		)) {
			fields[column.column_name] =
				prior?.fields[column.column_name] ?? "AWAITING_OWNER_DECISION";
		}
		tables[tablename] = {
			classification:
				prior?.classification ?? "AWAITING_OWNER_DECISION",
			rationale: prior?.rationale ?? "",
			fields,
		};
	}
	await writeJson(resolve(artifactsRoot, "source-classification.json"), {
		formatVersion: 1,
		inventoryChecksum: inventoryDocument.checksum,
		tables,
	} satisfies SourceClassification);
	console.log(JSON.stringify({
		tables: Object.keys(tables).length,
		awaitingOwnerDecision: Object.values(tables).filter(
			(item) =>
				item.classification === "AWAITING_OWNER_DECISION" ||
				Object.values(item.fields).includes("AWAITING_OWNER_DECISION"),
		).length,
	}));
};

const planWithClassification = async (rows: ExportRow[]) => {
	const [inventoryDocument, classification] = await Promise.all([
		readFile(resolve(artifactsRoot, "inventory.json"), "utf8").then(
			(value) => JSON.parse(value) as {
				checksum: string;
				tables: Array<{ tablename: string }>;
				columns: Array<{ table_name: string; column_name: string }>;
			},
		),
		readFile(resolve(artifactsRoot, "source-classification.json"), "utf8")
			.then((value) => JSON.parse(value) as SourceClassification),
	]);
	if (classification.inventoryChecksum !== inventoryDocument.checksum) {
		throw new Error("Source classification does not match the current V1 inventory.");
	}
	const unresolved: string[] = [];
	for (const { tablename } of inventoryDocument.tables) {
		const table = classification.tables[tablename];
		if (!table) {
			unresolved.push(`${tablename}: missing table classification`);
			continue;
		}
		if (table.classification === "AWAITING_OWNER_DECISION") {
			unresolved.push(`${tablename}: awaiting owner decision`);
		}
		if (
			(table.classification === "PLATFORM_INTERNAL" ||
				table.classification === "INTENTIONALLY_EXCLUDED") &&
			table.rationale.trim().length < 10
		) {
			unresolved.push(`${tablename}: exclusion rationale is required`);
		}
		for (const { column_name } of inventoryDocument.columns.filter(
			(column) => column.table_name === tablename,
		)) {
			if (!table.fields[column_name]) {
				unresolved.push(`${tablename}.${column_name}: missing classification`);
			} else if (table.fields[column_name] === "AWAITING_OWNER_DECISION") {
				unresolved.push(`${tablename}.${column_name}: awaiting owner decision`);
			}
		}
	}
	if (unresolved.length) {
		throw new Error(
			`Migration classification is incomplete (${unresolved.length} decisions). First items: ${unresolved.slice(0, 10).join("; ")}`,
		);
	}
	const mappedRows = rows.filter(
		(item) => classification.tables[item.table]?.classification === "MAPPED",
	);
	const mapped = planRows(mappedRows, {
		ownerUserId: required("V2_OWNER_USER_ID"),
	});
	const mappedByKey = new Map(mapped.map((item) => [item.idempotencyKey, item]));
	return rows.map((item) => {
		const identity = sourceIdentity(item.table, item.row);
		const table = classification.tables[item.table];
		if (table?.classification === "MAPPED") {
			const outcome = mappedByKey.get(identity.idempotencyKey);
			if (!outcome) throw new Error(`No mapping outcome for ${item.table}`);
			return outcome;
		}
		return {
			...identity,
			sourceTable: item.table,
			outcome: "EXCLUDED" as const,
			reasonCode: table?.classification,
		};
	});
};

const plan = async () => {
	const { manifest, rows } = await loadExport();
	const outcomes = await planWithClassification(rows);
	const summary = summarize(outcomes);
	const privatePlan = {
		formatVersion: 1,
		sourceManifestChecksum: manifest.checksum,
		sourceWatermark: manifest.watermark,
		complete: summary.complete,
		outcomes,
	};
	await writeJson(resolve(artifactsRoot, "plan.private.json"), privatePlan);
	const report = {
		formatVersion: 1,
		sourceManifestChecksum: manifest.checksum,
		sourceWatermark: manifest.watermark,
		...summary,
		zeroUnexplainedLoss:
			summary.total === rows.length &&
			summary.accounted === rows.length &&
			summary.complete,
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

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: {};

const asString = (value: unknown, fallback = "") =>
	value === undefined || value === null ? fallback : String(value);

const asDate = (value: unknown, fallback = new Date("2026-01-01T00:00:00.000Z")) => {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
	if (value !== undefined && value !== null) {
		const date = new Date(String(value));
		if (!Number.isNaN(date.getTime())) return date;
	}
	return fallback;
};

const asNumber = (value: unknown, fallback = 0) => {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
};

const jsonValue = (value: unknown) =>
	value === undefined || value === null ? null : JSON.stringify(value);

const firstArrayValue = (value: unknown) =>
	Array.isArray(value) ? value[0] : undefined;

const oneOf = (value: unknown, values: readonly string[], fallback: string) => {
	const candidate = asString(value).toUpperCase();
	return values.includes(candidate) ? candidate : fallback;
};

const sourceTarget = (table: string, value: unknown) =>
	value === undefined || value === null || value === ""
		? null
		: targetIdFor(table, String(value));

const sourceRowOf = (outcome: MigrationOutcome) =>
	asRecord(outcome.payload?.sourceSnapshot);

const ownerOf = (outcome: MigrationOutcome, ownerUserId: string) =>
	asString(outcome.payload?.ownerUserId, ownerUserId);

const sourceTimes = (outcome: MigrationOutcome) => {
	const row = sourceRowOf(outcome);
	return {
		createdAt: asDate(outcome.payload?.createdAt ?? row.created_at),
		updatedAt: asDate(outcome.payload?.updatedAt ?? row.updated_at ?? row.created_at),
	};
};

const insertRow = async (
	client: pg.Client,
	table: string,
	values: JsonRecord,
	conflict = "DO NOTHING",
) => {
	const entries = Object.entries(values);
	const columns = entries.map(([key]) => safeIdentifier(key)).join(",");
	const placeholders = entries.map((_, index) => `$${index + 1}`).join(",");
	await client.query(
		`INSERT INTO ${safeIdentifier(table)} (${columns}) VALUES (${placeholders}) ON CONFLICT ${conflict}`,
		entries.map(([, value]) => value),
	);
};

const ensureContact = async (
	client: pg.Client,
	id: string,
	ownerUserId: string,
	name = "Imported contact",
) => {
	const parts = name.trim().split(/\s+/);
	await insertRow(client, "contact", {
		id,
		firstName: parts[0] || "Imported",
		lastName: parts.slice(1).join(" ") || null,
		ownerId: ownerUserId,
		source: "IMPORT",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	});
};

const ensureCompany = async (
	client: pg.Client,
	id: string,
	ownerUserId: string,
	name = "Imported company",
) => {
	await insertRow(client, "company", {
		id,
		name,
		ownerId: ownerUserId,
		source: "IMPORT",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	});
};

const ensureLead = async (
	client: pg.Client,
	id: string,
	ownerUserId: string,
	name = "Imported lead",
) => {
	const contactId = `${id}_contact`;
	await ensureContact(client, contactId, ownerUserId, name);
	await insertRow(client, "lead", {
		id,
		name,
		status: "NEW",
		contactId,
		ownerUserId,
		createdByUserId: ownerUserId,
		source: "IMPORT",
		sourceKey: `ibl-v1:synthetic-lead:${id}`,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	});
};

const ensureMailbox = async (
	client: pg.Client,
	id: string,
	ownerUserId: string,
	address = "imported-mailbox@example.test",
) => {
	await insertRow(client, "mailbox", {
		id,
		ownerUserId,
		provider: "MIAB",
		address,
		normalizedAddress: address.toLowerCase(),
		status: "UNVERIFIED",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	});
};

const ensureRoute = async (
	client: pg.Client,
	id: string,
	ownerUserId: string,
	contactId: string | null,
	companyId: string | null,
) => {
	if (!contactId && !companyId) {
		contactId = `${id}_contact`;
		await ensureContact(client, contactId, ownerUserId, "Imported route contact");
	}
	await insertRow(client, "contactRoute", {
		id,
		contactId,
		companyId,
		ownerUserId,
		type: "EMAIL",
		value: "imported-route@example.test",
		normalizedValue: "imported-route@example.test",
		visibility: "PRIVATE",
		sourceKey: `ibl-v1:synthetic-route:${id}`,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	});
};

const ensureProposal = async (
	client: pg.Client,
	id: string,
	ownerUserId: string,
	leadId: string | null,
) => {
	await insertRow(client, "proposal", {
		id,
		title: "Imported proposal",
		content: {},
		ownerUserId,
		leadId,
		sourceKey: `ibl-v1:synthetic-proposal:${id}`,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	});
};

const ensureDuplicateCandidate = async (
	client: pg.Client,
	id: string,
	ownerUserId: string,
) => {
	await ensureContact(client, id, ownerUserId, "Imported duplicate candidate");
	await ensureContact(client, `${id}_right`, ownerUserId, "Imported duplicate candidate");
	await insertRow(client, "duplicateCandidate", {
		id,
		entityType: "CONTACT",
		leftEntityId: id,
		rightEntityId: `${id}_right`,
		score: 0,
		reasons: jsonValue([]),
		scoreComponents: jsonValue({}),
		detectorVersion: "v1-import",
		leftVersion: 1,
		rightVersion: 1,
		reviewedById: ownerUserId,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	});
};

const ensureEvidenceSource = async (
	client: pg.Client,
	id: string,
	ownerUserId: string,
	row: JsonRecord,
) => {
	const locator = asString(row.source_url, `ibl-v1:${id}`);
	await insertRow(client, "evidenceSource", {
		id,
		kind: row.source_url ? "PUBLIC_URL" : "IMPORT",
		locator,
		checksum: stableHash(JSON.stringify(row)),
		title: asString(row.source_title, "Imported source"),
		capturedAt: asDate(row.accessed_at ?? row.verified_at ?? row.imported_at),
		createdByUserId: ownerUserId,
		metadata: jsonValue(row),
		createdAt: asDate(row.created_at ?? row.imported_at),
	});
};

const targetEntity = (outcome: MigrationOutcome) => {
	const row = sourceRowOf(outcome);
	if (row.lead_id) return { type: "LEAD", id: sourceTarget("leads", row.lead_id) as string };
	if (row.entity_id) return { type: "CONTACT", id: sourceTarget("football_entities", row.entity_id) as string };
	return { type: "CONTACT", id: outcome.targetId as string };
};

const ensureDomainEntity = async (
	client: pg.Client,
	entity: { type: string; id: string },
	ownerUserId: string,
) => {
	if (entity.type === "CONTACT") await ensureContact(client, entity.id, ownerUserId);
	if (entity.type === "COMPANY") await ensureCompany(client, entity.id, ownerUserId);
	if (entity.type === "LEAD") await ensureLead(client, entity.id, ownerUserId);
};

const insertMapped = async (
	client: pg.Client,
	outcome: MigrationOutcome,
	ownerUserId: string,
) => {
	const p = outcome.payload ?? {};
	const row = sourceRowOf(outcome);
	const source = outcome.sourceTable;
	const id = outcome.targetId as string;
	const owner = ownerOf(outcome, ownerUserId);
	const times = sourceTimes(outcome);
	if (!outcome.targetTable || !id) throw new Error("Mapped outcome has no target identity");
	if (outcome.targetTable === "legacyIdMap") return;
	if (outcome.targetTable === "user") {
		await insertRow(client, "user", {
			id,
			name: asString(p.name, "Imported user"),
			email: asString(p.email, `${id}@import.invalid`),
			emailVerified: false,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "userProfile") {
		await insertRow(
			client,
			"userProfile",
			{
				userId: asString(p.userId, owner),
				status: "ACTIVE",
				preferredLanguage: "English",
				locale: asString(p.locale, "en"),
				timeZone: asString(p.timeZone, "Europe/Amsterdam"),
				workingPreferences: jsonValue(row),
				createdAt: times.createdAt,
				updatedAt: times.updatedAt,
			},
			'("userId") DO UPDATE SET "workingPreferences"="userProfile"."workingPreferences" || EXCLUDED."workingPreferences", "updatedAt"=EXCLUDED."updatedAt"',
		);
		return;
	}
	if (outcome.targetTable === "company") {
		await insertRow(client, "company", {
			id,
			name: asString(p.name, "Imported company"),
			country: p.country ?? null,
			website: p.website ?? null,
			ownerId: p.ownerId ?? null,
			source: "IMPORT",
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "contact") {
		await insertRow(client, "contact", {
			id,
			firstName: asString(p.firstName, "Imported"),
			lastName: p.lastName ?? null,
			email: p.email ?? null,
			phone: p.phone ?? null,
			title: p.title ?? null,
			ownerId: p.ownerId ?? null,
			source: "IMPORT",
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "footballPlayer") {
		const contactId = id;
		await ensureContact(client, contactId, owner, asString(row.display_name, "Imported player"));
		await insertRow(client, "footballPlayer", {
			contactId,
			position: row.position ?? null,
			nationality: row.national_team ?? row.nationality ?? null,
			currentClubId: sourceTarget("football_entities", row.club),
			sourceKey: p.sourceKey,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "footballAgent") {
		await ensureContact(client, id, owner, asString(row.display_name, "Imported agent"));
		await insertRow(client, "footballAgent", {
			contactId: id,
			agencyId: sourceTarget("football_entities", row.agency_id ?? firstArrayValue(row.agency_relationships)),
			licenseNumber: row.license_number ?? null,
			licenseCountry: row.license_country ?? null,
			sourceKey: p.sourceKey,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "agency" || outcome.targetTable === "club") {
		const companyId = id;
		await ensureCompany(client, companyId, owner, asString(row.display_name, "Imported organization"));
		if (outcome.targetTable === "agency") {
			await insertRow(client, "agency", {
				companyId,
				registrationId: row.registration_id ?? null,
				jurisdiction: row.jurisdiction ?? row.country_region ?? null,
				sourceKey: p.sourceKey,
				createdAt: times.createdAt,
				updatedAt: times.updatedAt,
			});
		} else {
			await insertRow(client, "club", {
				companyId,
				association: row.association ?? null,
				league: row.league ?? null,
				countryCode: row.country_region ?? row.country_code ?? null,
				sourceKey: p.sourceKey,
				createdAt: times.createdAt,
				updatedAt: times.updatedAt,
			});
		}
		return;
	}
	if (outcome.targetTable === "lead") {
		const companyId = sourceTarget("leads", `${id}:company`) as string;
		await ensureCompany(client, companyId, owner, asString(p.organization, "Imported organization"));
		await insertRow(client, "lead", {
			id,
			name: asString(p.name),
			status: oneOf(p.status, ["NEW", "QUALIFIED", "NURTURING", "CONVERTED", "DISQUALIFIED", "ARCHIVED"], "NEW"),
			ownerUserId: owner,
			createdByUserId: asString(p.createdByUserId, owner),
			companyId,
			source: "IMPORT",
			sourceKey: p.sourceKey,
			nextActionAt: p.nextActionAt ? asDate(p.nextActionAt) : null,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "operationalTask") {
		await insertRow(client, "operationalTask", {
			id,
			title: asString(p.title, "Imported task"),
			description: p.description ?? null,
			status: oneOf(p.status, ["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"], "TODO") === "OPEN" ? "TODO" : oneOf(p.status, ["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"], "TODO"),
			priority: oneOf(p.priority, ["LOW", "NORMAL", "HIGH", "URGENT"], "NORMAL"),
			assigneeUserId: asString(p.assigneeUserId, owner),
			createdByUserId: asString(p.createdByUserId, owner),
			leadId: sourceTarget("leads", row.lead_id),
			dueAt: p.dueAt ? asDate(p.dueAt) : null,
			completedAt: p.completedAt ? asDate(p.completedAt) : null,
			idempotencyKey: p.sourceKey,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "activity") {
		const method = asString(row.method ?? row.call_direction).toUpperCase();
		await insertRow(client, "activity", {
			id,
			type: method.includes("CALL") ? "CALL" : method.includes("EMAIL") ? "EMAIL" : "NOTE",
			subject: row.contacted_person ?? row.classification ?? null,
			body: row.summary ?? row.message_text ?? row.pasted_reply ?? row.next_action ?? null,
			occurredAt: asDate(row.occurred_at ?? row.created_at),
			dueAt: row.follow_up_at ? asDate(row.follow_up_at) : null,
			completedAt: row.completed_at ? asDate(row.completed_at) : null,
			createdById: owner,
			meta: jsonValue(row),
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "contactRoute") {
		let contactId: string | null = typeof p.contactId === "string" ? p.contactId : null;
		let companyId: string | null = typeof p.companyId === "string" ? p.companyId : null;
		if (!contactId && !companyId && row.lead_id) {
			companyId = sourceTarget("leads", `${row.lead_id}:company`);
			if (companyId) await ensureCompany(client, companyId, owner, "Imported lead organization");
		}
		if (!contactId && !companyId) {
			contactId = `${id}_contact`;
			await ensureContact(client, contactId, owner, "Imported route contact");
		}
		if (contactId) await ensureContact(client, String(contactId), owner);
		if (companyId) await ensureCompany(client, String(companyId), owner);
		await insertRow(client, "contactRoute", {
			id,
			contactId,
			companyId,
			ownerUserId: owner,
			type: oneOf(p.type, ["EMAIL", "PHONE", "WHATSAPP", "LINKEDIN", "SOCIAL", "OTHER"], "OTHER"),
			value: asString(p.value, "imported-route@example.test"),
			normalizedValue: asString(p.normalizedValue, asString(p.value, "imported-route@example.test").toLowerCase()),
			label: p.label ?? null,
			visibility: "PRIVATE",
			verifiedAt: p.verifiedAt ? asDate(p.verifiedAt) : null,
			sourceKey: p.sourceKey,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "contactRouteConsent") {
		const routeId = sourceTarget("contact_routes", row.route_id ?? row.contact_route_id ?? source);
		const contactId = sourceTarget("football_entities", row.contact_id ?? row.entity_id ?? `${source}:${id}`);
		await ensureContact(client, String(contactId), owner);
		await ensureRoute(client, String(routeId), owner, String(contactId), null);
		await insertRow(client, "contactRouteConsent", {
			id,
			routeId,
			contactId,
			status: oneOf(row.status, ["ALLOWED", "DO_NOT_CONTACT"], "ALLOWED"),
			reason: row.reason ?? null,
			source: "V1_IMPORT",
			changedByUserId: owner,
			changedAt: asDate(row.changed_at ?? row.created_at),
			consentedAt: asDate(row.consented_at ?? row.created_at),
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "representation") {
		const playerId = sourceTarget("football_entities", row.to_entity_id ?? row.player_entity_id) ?? id;
		const agentId = sourceTarget("football_entities", row.from_entity_id ?? row.agent_entity_id) ?? id;
		await ensureContact(client, String(playerId), owner, "Imported player");
		await ensureContact(client, String(agentId), owner, "Imported agent");
		const agencyId = sourceTarget("football_entities", row.agency_entity_id);
		if (agencyId) await ensureCompany(client, agencyId, owner, "Imported agency");
		await insertRow(client, "representation", {
			id,
			playerContactId: playerId,
			agentContactId: agentId,
			agencyCompanyId: agencyId,
			status: oneOf(row.status ?? row.relationship_type, ["PENDING", "ACTIVE", "FORMER", "DISPUTED"], "ACTIVE"),
			startedAt: row.started_at ? asDate(row.started_at) : null,
			endedAt: row.ended_at ? asDate(row.ended_at) : null,
			sourceKey: p.sourceKey,
			createdByUserId: owner,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "mailbox") {
		const address = asString(row.email, `${id}@import.invalid`).toLowerCase();
		await insertRow(client, "mailbox", {
			id,
			ownerUserId: owner,
			provider: "MIAB",
			address,
			normalizedAddress: address,
			displayName: row.display_name ?? null,
			signature: row.signature ?? null,
			status: oneOf(row.status, ["DISABLED", "UNVERIFIED", "VERIFIED", "ERROR"], "UNVERIFIED"),
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "mailboxSync") {
		const mailboxId = sourceTarget("mailbox_connections", row.mailbox_id ?? "mailbox-1") as string;
		await ensureMailbox(client, mailboxId, owner);
		await insertRow(client, "mailboxSync", {
			id,
			userId: owner,
			source: asString(row.source, "import"),
			mailboxId,
			status: oneOf(row.status, ["IDLE", "RUNNING", "NEEDS_RECONNECT", "FAILED"], "IDLE"),
			lastSyncedAt: row.last_successful_sync_at ? asDate(row.last_successful_sync_at) : null,
			lastError: row.error ?? null,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "emailThread") {
		const mailboxId = sourceTarget("mailbox_connections", row.mailbox_id ?? "mailbox-1") as string;
		await ensureMailbox(client, mailboxId, owner);
		const first = asDate(row.first_message_at ?? row.created_at);
		const last = asDate(row.last_message_at ?? row.updated_at ?? row.created_at, first);
		await insertRow(client, "emailThread", {
			id,
			mailboxId,
			rootMessageId: asString(row.thread_key, `ibl-v1:${id}`),
			subject: row.subject ?? null,
			firstMessageAt: first,
			lastMessageAt: last,
			messageCount: 0,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "emailMessage") {
		const mailboxId = sourceTarget("mailbox_connections", row.mailbox_id ?? "mailbox-1") as string;
		const threadId = sourceTarget("email_threads", row.thread_id ?? "thread-1") as string;
		await ensureMailbox(client, mailboxId, owner);
		await insertRow(client, "emailThread", {
			id: threadId,
			mailboxId,
			rootMessageId: `ibl-v1:${threadId}`,
			firstMessageAt: asDate(row.received_at ?? row.sent_at),
			lastMessageAt: asDate(row.received_at ?? row.sent_at),
			messageCount: 0,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		await insertRow(client, "emailMessage", {
			id,
			threadId,
			mailboxId,
			rfcMessageId: asString(row.message_id, `ibl-v1:${id}`),
			syncedByUserId: owner,
			direction: oneOf(row.direction, ["INBOUND", "OUTBOUND"], "INBOUND"),
			fromEmail: asString(row.from_email, "imported@example.test"),
			fromName: row.from_name ?? null,
			recipients: jsonValue({ to: row.to_emails ?? [], cc: row.cc_emails ?? [], bcc: row.bcc_emails ?? [] }),
			subject: row.subject ?? null,
			snippet: row.snippet ?? null,
			body: row.text_body ?? row.html_body ?? null,
			sentAt: asDate(row.sent_at ?? row.received_at),
			createdAt: times.createdAt,
		});
		return;
	}
	if (outcome.targetTable === "messageAttachment") {
		const mailboxId = sourceTarget("mailbox_connections", row.mailbox_id ?? "mailbox-1") as string;
		const messageId = sourceTarget("email_messages", row.email_message_id ?? "message-1") as string;
		await ensureMailbox(client, mailboxId, owner);
		await insertRow(client, "messageAttachment", {
			id,
			mailboxId,
			messageId,
			filename: asString(row.file_name, "imported-attachment"),
			mediaType: asString(row.content_type, "application/octet-stream"),
			contentId: row.content_id ?? null,
			disposition: row.disposition ?? null,
			byteSize: Math.max(0, Math.trunc(asNumber(row.size_bytes, 0))),
			checksumSha256: stableHash(JSON.stringify(row)),
			objectKey: `v1-import/${id}`,
			status: "QUARANTINED",
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "draft") {
		await insertRow(client, "draft", {
			id,
			ownerUserId: owner,
			mailboxId: row.mailbox_id ? sourceTarget("mailbox_connections", row.mailbox_id) : null,
			recipientRouteId: row.route_id ? sourceTarget("contact_routes", row.route_id) : null,
			subject: p.subject ?? null,
			body: asString(p.body, "Imported draft"),
			status: oneOf(p.status, ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "QUEUED", "SENT", "FAILED", "CANCELLED"], "DRAFT"),
			idempotencyKey: asString(p.sourceKey, id),
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "template") {
		await insertRow(client, "template", {
			id,
			name: asString(p.name, "Imported template"),
			kind: oneOf(p.kind, ["EMAIL", "PROPOSAL", "RESEARCH", "FOLLOW_UP"], "EMAIL"),
			subject: p.subject ?? null,
			body: asString(p.body),
			active: p.active !== false,
			ownerUserId: p.ownerUserId ?? null,
			sourceKey: p.sourceKey,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "proofItem") {
		const contactId = row.entity_id
			? sourceTarget("football_entities", row.entity_id)
			: row.player_or_client
				? sourceTarget("football_entities", row.player_or_client)
				: `${id}_contact`;
		await ensureContact(client, String(contactId), owner, "Imported proof contact");
		await insertRow(client, "proofItem", {
			id,
			label: asString(p.label, "Imported proof"),
			proofType: asString(p.proofType, "legacy"),
			reference: p.reference ?? null,
			companyId: row.company_id ? sourceTarget("football_entities", row.company_id) : null,
			contactId,
			leadId: row.lead_id ? sourceTarget("leads", row.lead_id) : null,
			sourceKey: p.sourceKey,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "researchRequest") {
		const target = targetEntity(outcome);
		await insertRow(client, "researchRequest", {
			id,
			ownerUserId: owner,
			mailboxId: p.mailboxId ?? null,
			targetType: target.type,
			targetEntityId: target.id,
			prompt: asString(p.prompt, "Imported research request"),
			status: oneOf(p.status, ["QUEUED", "RUNNING", "NEEDS_REVIEW", "COMPLETED", "FAILED", "CANCELLED"], "QUEUED"),
			idempotencyKey: asString(p.sourceKey, id),
			completedAt: row.completed_at ? asDate(row.completed_at) : null,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "evidenceSource") {
		await ensureEvidenceSource(client, id, owner, row);
		return;
	}
	if (outcome.targetTable === "researchFinding") {
		const requestId = sourceTarget("research_requests", row.request_id ?? "research-1") as string;
		const evidenceId = sourceTarget("research_findings", row.id ?? id) as string;
		await insertRow(client, "researchRequest", {
			id: requestId,
			ownerUserId: owner,
			targetType: "LEAD",
			targetEntityId: sourceTarget("leads", row.lead_id ?? "lead-1") as string,
			prompt: "Imported research request",
			status: "COMPLETED",
			idempotencyKey: `ibl-v1:synthetic-research-request:${requestId}`,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		await ensureEvidenceSource(client, evidenceId, owner, row);
		await insertRow(client, "researchFinding", {
			id,
			requestId,
			evidenceSourceId: evidenceId,
			field: row.field_name ?? null,
			summary: asString(row.evidence_summary, asString(row.proposed_value, "Imported finding")),
			value: jsonValue(row.proposed_value),
			confidence: Math.min(1, Math.max(0, asNumber(row.confidence, 0))),
			status: oneOf(row.approval_state, ["PROPOSED", "ACCEPTED", "DISMISSED", "SUPERSEDED"], "PROPOSED") === "APPROVED" ? "ACCEPTED" : oneOf(row.approval_state, ["PROPOSED", "ACCEPTED", "DISMISSED", "SUPERSEDED"], "PROPOSED"),
			decidedAt: row.approved_at ? asDate(row.approved_at) : null,
			createdAt: times.createdAt,
		});
		return;
	}
	if (outcome.targetTable === "duplicateCandidate") {
		const leftEntityId = sourceTarget("football_entities", row.left_entity_id ?? row.entity_id ?? `${id}_left`) ?? `${id}_left`;
		const rightEntityId = sourceTarget("football_entities", row.right_entity_id ?? row.entity_id ?? `${id}_right`) ?? `${id}_right`;
		const duplicatePair = [leftEntityId, rightEntityId].sort() as [string, string];
		await ensureContact(client, duplicatePair[0], owner, "Imported duplicate entity");
		await ensureContact(client, duplicatePair[1], owner, "Imported duplicate entity");
		await insertRow(client, "duplicateCandidate", {
			id,
			entityType: "CONTACT",
			leftEntityId: duplicatePair[0],
			rightEntityId: duplicatePair[1],
			score: Math.min(1, Math.max(0, asNumber(row.confidence ?? row.score, 0))),
			reasons: jsonValue(row.match_reasons ?? row.reasons ?? []),
			scoreComponents: jsonValue(row.fuzzy_signals ?? {}),
			detectorVersion: "ibl-v1-import",
			leftVersion: 1,
			rightVersion: 1,
			status: oneOf(row.status, ["OPEN", "NOT_DUPLICATE", "MERGE_APPROVED", "MERGED", "DISMISSED"], "OPEN"),
			reviewedById: row.actor_id ? owner : null,
			reviewedAt: row.reviewed_at ? asDate(row.reviewed_at) : null,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "mergeDecision") {
		const candidateId = sourceTarget("duplicate_entity_pairs", row.pair_id ?? `${id}:candidate`) as string;
		await ensureDuplicateCandidate(client, candidateId, owner);
		const survivorEntityId = sourceTarget(asString(row.survivor_table, "football_entities"), row.survivor_id ?? `${id}:survivor`) as string;
		let duplicateEntityId = sourceTarget(asString(row.merged_table, "football_entities"), row.merged_id ?? `${id}:duplicate`) as string;
		if (duplicateEntityId === survivorEntityId) duplicateEntityId = `${duplicateEntityId}_duplicate`;
		await ensureContact(client, survivorEntityId, owner, "Imported merge survivor");
		await ensureContact(client, duplicateEntityId, owner, "Imported merge duplicate");
		await insertRow(client, "mergeDecision", {
			id,
			candidateId,
			survivorEntityId,
			duplicateEntityId,
			status: "APPROVED",
			decidedByUserId: owner,
			reason: row.resolution_note ?? null,
			fieldChoices: jsonValue(row.selected_fields ?? []),
			snapshot: jsonValue(row),
			idempotencyKey: asString(p.sourceKey, id),
			decidedAt: asDate(row.created_at),
		});
		return;
	}
	if (outcome.targetTable === "lifecycleEvent") {
		const entity = targetEntity(outcome);
		await ensureDomainEntity(client, entity, owner);
		await insertRow(client, "lifecycleEvent", {
			id,
			entityType: entity.type,
			entityId: entity.id,
			fromState: row.previous_state ?? row.from_state ?? null,
			toState: asString(row.resulting_state ?? row.to_state ?? row.status, "IMPORTED"),
			actorUserId: owner,
			reason: row.reason ?? row.link_reason ?? row.promotion_reason ?? null,
			metadata: jsonValue(row),
			idempotencyKey: asString(p.sourceKey, id),
			occurredAt: asDate(row.occurred_at ?? row.created_at),
		});
		return;
	}
	if (outcome.targetTable === "canonicalAlias") {
		await insertRow(client, "canonicalAlias", {
			id,
			entityType: "CONTACT",
			aliasEntityId: sourceTarget("football_entities", row.alias_entity_id ?? row.entity_id ?? id) as string,
			survivorEntityId: sourceTarget("football_entities", row.survivor_entity_id ?? row.entity_id ?? id) as string,
			createdByUserId: owner,
			reason: asString(row.reason, "Imported alias"),
			createdAt: times.createdAt,
		});
		return;
	}
	if (outcome.targetTable === "note") {
		const contactId = row.entity_id
			? sourceTarget("football_entities", row.entity_id)
			: row.lead_id
				? null
				: `${id}_contact`;
		if (contactId) await ensureContact(client, String(contactId), owner, "Imported note contact");
		await insertRow(client, "note", {
			id,
			body: asString(row.comment ?? row.notes ?? row.explanation, "Imported note"),
			authorUserId: owner,
			contactId,
			leadId: row.lead_id ? sourceTarget("leads", row.lead_id) : null,
			sourceKey: p.sourceKey,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "domainAuditEvent") {
		const entity = targetEntity(outcome);
		await ensureDomainEntity(client, entity, owner);
		await insertRow(client, "domainAuditEvent", {
			id,
			actorUserId: owner,
			action: `V1_IMPORT_${source.toUpperCase()}`,
			entityType: entity.type,
			entityId: entity.id,
			outcome: asString(row.status, "IMPORTED"),
			metadata: jsonValue(row),
			createdAt: times.createdAt,
		});
		return;
	}
	if (outcome.targetTable === "calendarEvent") {
		const startsAt = asDate(row.starts_at ?? row.start_at ?? row.created_at);
		await insertRow(client, "calendarEvent", {
			id,
			iCalUid: asString(row.ical_uid, `ibl-v1:${id}`),
			originalStartTime: startsAt,
			title: row.title ?? null,
			description: row.description ?? null,
			location: row.location ?? null,
			startsAt,
			endsAt: asDate(row.ends_at ?? row.end_at, new Date(startsAt.getTime() + 3600000)),
			isAllDay: Boolean(row.is_all_day),
			status: asString(row.status, "CONFIRMED"),
			organizerEmail: row.organizer_email ?? null,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "allocationRequest") {
		const entity = targetEntity(outcome);
		await ensureDomainEntity(client, entity, owner);
		await insertRow(client, "allocationRequest", {
			id,
			entityType: entity.type,
			entityId: entity.id,
			status: oneOf(row.status, ["PENDING", "LEASED", "ALLOCATED", "UNALLOCATED", "FAILED", "DEAD"], "PENDING"),
			requestedByUserId: owner,
			idempotencyKey: asString(p.sourceKey, id),
			explanation: jsonValue(row),
			assigneeUserId: row.assigned_to ? owner : null,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "proposal") {
		const leadId = sourceTarget("leads", row.lead_id ?? `${id}:proposal-lead`) as string;
		await ensureLead(client, leadId, owner);
		await insertRow(client, "proposal", {
			id,
			title: asString(row.title ?? row.name, "Imported proposal"),
			summary: row.summary ?? null,
			content: jsonValue(row),
			status: oneOf(row.status, ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "ACCEPTED", "WITHDRAWN"], "DRAFT"),
			ownerUserId: owner,
			leadId,
			draftId: sourceTarget("saved_email_drafts", row.draft_id),
			sourceKey: p.sourceKey,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		return;
	}
	if (outcome.targetTable === "proposalItem") {
		const proposalId = sourceTarget("ai_proposals", row.proposal_id ?? id) as string;
		const leadId = sourceTarget("leads", row.lead_id ?? `${id}:proposal-lead`) as string;
		await ensureLead(client, leadId, owner);
		await ensureProposal(client, proposalId, owner, leadId);
		await insertRow(client, "proposalItem", {
			id,
			proposalId,
			label: asString(row.label ?? row.name, "Imported item"),
			description: row.description ?? null,
			quantity: row.quantity ?? null,
			unitAmount: row.unit_amount ?? null,
			currency: row.currency ?? null,
			position: Math.max(0, Math.trunc(asNumber(row.position, 0))),
		});
		return;
	}
	if (outcome.targetTable === "sharedRoutePolicy") {
		const routeId = sourceTarget("contact_routes", row.contact_route_id ?? row.route_id ?? "route-1") as string;
		const contactId = row.entity_id ? sourceTarget("football_entities", row.entity_id) : `${id}_contact`;
		if (contactId) await ensureContact(client, contactId, owner);
		await ensureRoute(client, routeId, owner, contactId, null);
		await insertRow(client, "sharedRoutePolicy", {
			id,
			routeId,
			granteeContactId: contactId,
			granteeCompanyId: null,
			useForResearch: row.use_for_research !== false,
			useForOutreach: row.use_for_outreach === true,
			approvedByUserId: owner,
			approvedAt: asDate(row.approved_at ?? row.created_at),
			revokedAt: row.revoked_at ? asDate(row.revoked_at) : null,
			reason: row.outreach_rule ?? row.reason ?? null,
		});
		return;
	}
	if (outcome.targetTable === "companyEnrichment") {
		const companyId = sourceTarget("football_entities", row.entity_id ?? id) as string;
		await ensureCompany(client, companyId, owner);
		await insertRow(client, "companyEnrichment", {
			companyId,
			source: "V1_IMPORT",
			raw: jsonValue(row),
			fetchedAt: asDate(row.updated_at ?? row.created_at),
		});
		return;
	}
	if (outcome.targetTable === "contactFact") {
		const contactId = sourceTarget("football_entities", row.entity_id ?? id) as string;
		await ensureContact(client, contactId, owner);
		await insertRow(client, "contactFact", {
			id,
			contactId,
			field: asString(row.field_name, "legacy_field"),
			value: asString(row.field_value ?? row.proposed_value, ""),
			score: Math.min(1, Math.max(0, asNumber(row.confidence, 0))),
			band: oneOf(row.band, ["VERIFIED", "PROBABLE", "POSSIBLE"], "POSSIBLE"),
			evidence: jsonValue(row),
			method: "V1_IMPORT",
			sourceUrl: row.source_url ?? null,
			status: oneOf(row.status, ["APPLIED", "PROPOSED", "DISMISSED", "SUPERSEDED"], "PROPOSED"),
			decidedById: row.created_by ? owner : null,
			decidedAt: row.verified_at ? asDate(row.verified_at) : null,
			observedAt: asDate(row.verified_at ?? row.created_at),
		});
		return;
	}
	if (outcome.targetTable === "outreachEvent") {
		const deliveryId = sourceTarget("outbound_deliveries", row.delivery_id ?? `${id}:delivery`) as string;
		const draftId = sourceTarget("saved_email_drafts", row.draft_id ?? `${id}:delivery-draft`) as string;
		await insertRow(client, "draft", {
			id: draftId,
			ownerUserId: owner,
			body: "Imported delivery draft",
			status: "DRAFT",
			idempotencyKey: `ibl-v1:synthetic-delivery-draft:${draftId}`,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		await insertRow(client, "outboundDelivery", {
			id: deliveryId,
			draftId,
			status: "PENDING",
			idempotencyKey: `ibl-v1:synthetic-delivery:${deliveryId}`,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
		});
		await insertRow(client, "outreachEvent", {
			id,
			deliveryId,
			eventType: asString(row.event_type, "IMPORTED"),
			providerEventId: asString(row.provider_event_id, `ibl-v1:${id}`),
			providerMessageId: row.provider_message_id ?? null,
			occurredAt: asDate(row.occurred_at ?? row.created_at),
			payloadDigest: stableHash(JSON.stringify(row)),
			createdAt: times.createdAt,
		});
		return;
	}
	throw new Error(`Unsupported target table: ${outcome.targetTable}`);
};

const targetKeyColumn = (targetTable: string) => {
	if (targetTable === "userProfile") return "userId";
	if (targetTable === "footballPlayer" || targetTable === "footballAgent") return "contactId";
	if (targetTable === "agency" || targetTable === "club") return "companyId";
	return "id";
};

const targetRow = async (
	client: pg.Client,
	targetTable: string,
	targetId: string,
) => {
	if (targetTable === "legacyIdMap") return null;
	const key = targetKeyColumn(targetTable);
	const result = await client.query(
		`SELECT to_jsonb(t) AS row FROM ${safeIdentifier(targetTable)} t WHERE ${safeIdentifier(key)}=$1`,
		[targetId],
	);
	return result.rows[0]?.row ?? null;
};

const ledgerSnapshot = (outcome: MigrationOutcome) =>
	outcome.payload?.sourceSnapshot ?? {};

const persistOutcomeLedger = async (
	client: pg.Client,
	runId: string,
	outcome: MigrationOutcome,
	targetSnapshot: unknown,
) => {
	await client.query(
		`INSERT INTO "legacyMigrationOutcome" ("idempotencyKey","runId","sourceTable","sourceIdHash","outcome","targetTable","targetId","reasonCode") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT ("idempotencyKey") DO NOTHING`,
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
	await client.query(
		`INSERT INTO "legacyMigrationFieldLedger" ("idempotencyKey","runId","sourceTable","sourceIdHash","targetTable","targetId","sourceSnapshot","payload","fieldCoverage","targetSnapshot") VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb) ON CONFLICT ("idempotencyKey") DO UPDATE SET "targetSnapshot"=EXCLUDED."targetSnapshot","updatedAt"=CURRENT_TIMESTAMP`,
		[
			outcome.idempotencyKey,
			runId,
			outcome.sourceTable,
			outcome.sourceIdHash,
			outcome.targetTable ?? null,
			outcome.targetId ?? null,
			JSON.stringify(ledgerSnapshot(outcome)),
			JSON.stringify(outcome.payload ?? {}),
			JSON.stringify(outcome.fieldCoverage ?? { mapped: [], intentionallyExcluded: {}, unsupported: {} }),
			targetSnapshot === null || targetSnapshot === undefined ? null : JSON.stringify(targetSnapshot),
		],
	);
};

	type PlanDocument = {
		sourceManifestChecksum: string;
		sourceWatermark: { transaction_id: string };
		outcomes: MigrationOutcome[];
		complete: boolean;
	};

const applyPlanDocument = async (
	planDocument: PlanDocument,
	ownerUserId: string,
	client: pg.Client,
	runId: string,
) => {
	if (!planDocument.complete) throw new Error("Apply is blocked: unresolved business rows remain in the migration plan.");
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
		for (const outcome of orderMigrationOutcomes(planDocument.outcomes)) {
			const already = await client.query(
				'SELECT 1 FROM "legacyMigrationOutcome" WHERE "idempotencyKey"=$1',
				[outcome.idempotencyKey],
			);
			if (already.rowCount) {
				const targetAlreadyExists =
					outcome.outcome !== "MAPPED" ||
					!outcome.targetTable ||
					!outcome.targetId ||
					outcome.targetTable === "legacyIdMap" ||
					(await targetRow(client, outcome.targetTable, outcome.targetId)) !== null;
				if (targetAlreadyExists) continue;
			}
			let inserted = false;
			if (
				outcome.outcome === "MAPPED" &&
				outcome.targetTable &&
				outcome.targetId
			) {
				const before = await targetRow(client, outcome.targetTable, outcome.targetId);
				await insertMapped(client, outcome, ownerUserId);
				const after = await targetRow(client, outcome.targetTable, outcome.targetId);
				inserted = before === null && after !== null;
				const mappedTargetTable =
					outcome.targetTable === "legacyIdMap"
						? asString(outcome.payload?.parentTargetId ? "football_entities" : "legacyIdMap")
						: outcome.targetTable;
				const mappedTargetId =
					outcome.targetTable === "legacyIdMap"
						? asString(outcome.payload?.parentTargetId, outcome.targetId)
						: outcome.targetId;
				await client.query(
					`INSERT INTO "legacyIdMap" ("idempotencyKey","sourceTable","sourceIdHash","targetTable","targetId") VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("idempotencyKey") DO UPDATE SET "targetTable"=EXCLUDED."targetTable","targetId"=EXCLUDED."targetId"`,
					[
						outcome.idempotencyKey,
						outcome.sourceTable,
						outcome.sourceIdHash,
						mappedTargetTable,
						mappedTargetId,
					],
				);
				if (inserted) {
					const targetFingerprint = stableHash(canonicalJson(after));
					await client.query(
						`INSERT INTO "legacyRollbackEntry" ("runId","targetTable","targetId","operation","targetFingerprint") VALUES ($1,$2,$3,'DELETE_INSERTED_ROW',$4)`,
						[runId, outcome.targetTable, outcome.targetId, targetFingerprint],
					);
				}
			}
			await persistOutcomeLedger(
				client,
				runId,
				outcome,
				outcome.outcome === "MAPPED" && outcome.targetTable && outcome.targetId
					? await targetRow(client, outcome.targetTable, outcome.targetId)
					: null,
			);
		}
		const report = summarize(planDocument.outcomes);
		await client.query(
			`UPDATE "legacyMigrationRun" SET "status"='COMPLETED', "completedAt"=NOW(), "report"=$2::jsonb WHERE "id"=$1`,
			[runId, JSON.stringify(report)],
		);
	await client.query("COMMIT");
	return { runId, ...report };
};

const apply = async () => {
	if (!confirmApply)
		throw new Error(
			"Apply requires --confirm-apply after reviewing reconciliation.json",
		);
	const planDocument = JSON.parse(
		await readFile(resolve(artifactsRoot, "plan.private.json"), "utf8"),
	) as PlanDocument;
	const ownerUserId = required("V2_OWNER_USER_ID");
	const client = await connect(required("DATABASE_URL"));
	const runId = `v1_apply_${stableHash(`${planDocument.sourceManifestChecksum}:${ownerUserId}`).slice(0, 24)}`;
	try {
		console.log(JSON.stringify(await applyPlanDocument(planDocument, ownerUserId, client, runId), null, 2));
	} catch (error) {
		await client.query("ROLLBACK").catch(() => undefined);
		throw error;
	} finally {
		await client.end();
	}
};

const fixtureApply = async () => {
	if (!confirmApply) throw new Error("Fixture apply requires --confirm-apply");
	const ownerUserId = required("V2_OWNER_USER_ID");
	const outcomes = planRows(businessV1Rows, { ownerUserId });
	const summary = summarize(outcomes);
	if (!summary.complete) throw new Error("Sanitized fixture plan is incomplete");
	const planDocument: PlanDocument = {
		sourceManifestChecksum: stableHash(canonicalJson(businessV1Rows)),
		sourceWatermark: { transaction_id: "sanitized-fixture" },
		outcomes,
		complete: summary.complete,
	};
	const client = await connect(required("DATABASE_URL"));
	const runId = `v1_fixture_apply_${stableHash(`${planDocument.sourceManifestChecksum}:${ownerUserId}`).slice(0, 24)}`;
	try {
		console.log(JSON.stringify(await applyPlanDocument(planDocument, ownerUserId, client, runId), null, 2));
	} catch (error) {
		await client.query("ROLLBACK").catch(() => undefined);
		throw error;
	} finally {
		await client.end();
	}
};

const mappedTargetFor = (outcome: MigrationOutcome) => {
	if (outcome.targetTable !== "legacyIdMap") {
		return { targetTable: outcome.targetTable, targetId: outcome.targetId };
	}
	return {
		targetTable: outcome.payload?.parentTargetId ? "football_entities" : "legacyIdMap",
		targetId: asString(outcome.payload?.parentTargetId, outcome.targetId),
	};
};

const foreignKeyViolations = async (client: pg.Client) => {
	const constraints = (
		await client.query(
			`SELECT child.relname AS "childTable", parent.relname AS "parentTable", childColumn.attname AS "childColumn", parentColumn.attname AS "parentColumn"
			 FROM pg_constraint c
			 JOIN pg_class child ON child.oid=c.conrelid
			 JOIN pg_class parent ON parent.oid=c.confrelid
			 JOIN pg_namespace childNamespace ON childNamespace.oid=child.relnamespace
			 JOIN pg_namespace parentNamespace ON parentNamespace.oid=parent.relnamespace
			 JOIN pg_attribute childColumn ON childColumn.attrelid=child.oid AND childColumn.attnum=c.conkey[1]
			 JOIN pg_attribute parentColumn ON parentColumn.attrelid=parent.oid AND parentColumn.attnum=c.confkey[1]
			 WHERE c.contype='f' AND array_length(c.conkey,1)=1 AND array_length(c.confkey,1)=1 AND childNamespace.nspname='public' AND parentNamespace.nspname='public'`,
		)
	).rows as Array<{ childTable: string; parentTable: string; childColumn: string; parentColumn: string }>;
	let violations = 0;
	for (const constraint of constraints) {
		const result = await client.query(
			`SELECT count(*)::int AS count FROM ${safeIdentifier(constraint.childTable)} child WHERE child.${safeIdentifier(constraint.childColumn)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${safeIdentifier(constraint.parentTable)} parent WHERE parent.${safeIdentifier(constraint.parentColumn)}=child.${safeIdentifier(constraint.childColumn)})`,
		);
		violations += Number(result.rows[0]?.count ?? 0);
	}
	return violations;
};

const reconcilePersisted = async (
	client: pg.Client,
	planDocument: PlanDocument,
) => {
	let missingIdMaps = 0;
	let missingTargets = 0;
	let targetMismatches = 0;
	let missingFieldLedgers = 0;
	let ownershipMismatches = 0;
	for (const outcome of planDocument.outcomes.filter((item) => item.outcome === "MAPPED")) {
		if (!outcome.targetTable || !outcome.targetId) {
			targetMismatches += 1;
			continue;
		}
		const expected = mappedTargetFor(outcome);
		const mapping = await client.query(
			`SELECT "targetTable","targetId" FROM "legacyIdMap" WHERE "idempotencyKey"=$1`,
			[outcome.idempotencyKey],
		);
		if (!mapping.rowCount) {
			missingIdMaps += 1;
		} else if (
			mapping.rows[0].targetTable !== expected.targetTable ||
			mapping.rows[0].targetId !== expected.targetId
		) {
			targetMismatches += 1;
		}
		const ledger = await client.query(
			`SELECT "targetSnapshot" FROM "legacyMigrationFieldLedger" WHERE "idempotencyKey"=$1`,
			[outcome.idempotencyKey],
		);
		if (!ledger.rowCount) missingFieldLedgers += 1;
		const target = outcome.targetTable === "legacyIdMap" ? null : await targetRow(client, outcome.targetTable, outcome.targetId);
		if (outcome.targetTable !== "legacyIdMap" && target === null) missingTargets += 1;
		const payload = outcome.payload ?? {};
		const expectedOwner = payload.ownerUserId ?? payload.ownerId ?? payload.assigneeUserId ?? payload.createdByUserId;
		const actualOwner = asRecord(target)[
			outcome.targetTable === "mailboxSync" ? "userId" : outcome.targetTable === "contact" || outcome.targetTable === "company" ? "ownerId" : outcome.targetTable === "operationalTask" ? "assigneeUserId" : "ownerUserId"
		];
		if (expectedOwner && actualOwner && expectedOwner !== actualOwner) ownershipMismatches += 1;
	}
	const ledgerCount = await client.query(
		`SELECT count(*)::int AS count FROM "legacyMigrationFieldLedger" WHERE "runId"=(SELECT "runId" FROM "legacyMigrationOutcome" WHERE "idempotencyKey"=$1)`,
		[planDocument.outcomes[0]?.idempotencyKey ?? ""],
	);
	const fieldCoverage = await client.query(
		`SELECT count(*)::int AS count FROM "legacyMigrationFieldLedger" WHERE EXISTS (SELECT 1 FROM jsonb_each("fieldCoverage"->'unsupported'))`,
	);
	const persistedTargets = await client.query(
		`SELECT count(*)::int AS count FROM "legacyMigrationFieldLedger" WHERE "targetTable" IS NOT NULL AND "targetTable" <> 'legacyIdMap' AND "targetSnapshot" IS NOT NULL`,
	);
	const relationshipRows = await client.query(
		`SELECT count(*)::int AS count FROM "legacyMigrationFieldLedger" WHERE "targetTable" IN ('representation','contactRoute','sharedRoutePolicy','emailThread','emailMessage') AND "targetSnapshot" IS NOT NULL`,
	);
	const lifecycleRows = await client.query(
		`SELECT count(*)::int AS count FROM "legacyMigrationFieldLedger" WHERE "targetTable" IN ('lifecycleEvent','activity','mergeDecision') AND "targetSnapshot" IS NOT NULL`,
	);
	return {
		missingIdMaps,
		missingTargets,
		targetMismatches,
		missingFieldLedgers,
		ownershipMismatches,
		ledgerRows: Number(ledgerCount.rows[0]?.count ?? 0),
		fieldCoverageUnsupportedRows: Number(fieldCoverage.rows[0]?.count ?? 0),
		persistedTargets: Number(persistedTargets.rows[0]?.count ?? 0),
		relationshipRows: Number(relationshipRows.rows[0]?.count ?? 0),
		lifecycleHistoryRows: Number(lifecycleRows.rows[0]?.count ?? 0),
		foreignKeyViolations: await foreignKeyViolations(client),
	};
};

const reconcilePlanDocument = async (
	planDocument: PlanDocument,
	expectedSourceRows: number,
	expectedManifestChecksum: string,
	expectedReport: { total: number; accounted: number; zeroUnexplainedLoss: boolean },
) => {
	const client = await connect(required("DATABASE_URL"));
	try {
		const persisted = await reconcilePersisted(client, planDocument);
		const checks = {
			manifestChecksumMatches: expectedManifestChecksum === planDocument.sourceManifestChecksum,
			sourceRows: expectedSourceRows,
			outcomes: expectedReport.total,
			accounted: expectedReport.accounted,
			classificationComplete: planDocument.complete,
			zeroUnexplainedLoss: expectedSourceRows === expectedReport.total && expectedReport.total === expectedReport.accounted && expectedReport.zeroUnexplainedLoss,
			...persisted,
			targetReconciled: persisted.missingIdMaps === 0 && persisted.missingTargets === 0 && persisted.targetMismatches === 0 && persisted.missingFieldLedgers === 0 && persisted.ownershipMismatches === 0 && persisted.fieldCoverageUnsupportedRows === 0 && persisted.foreignKeyViolations === 0,
		};
		console.log(JSON.stringify(checks, null, 2));
		if (!checks.manifestChecksumMatches || !checks.classificationComplete || !checks.zeroUnexplainedLoss || !checks.targetReconciled) process.exitCode = 1;
		return checks;
	} finally {
		await client.end();
	}
};

const reconcile = async () => {
	const { manifest, rows } = await loadExport();
	const [report, planDocument] = await Promise.all([
		readFile(resolve(artifactsRoot, "reconciliation.json"), "utf8").then((value) => JSON.parse(value) as { total: number; accounted: number; sourceManifestChecksum: string; zeroUnexplainedLoss: boolean }),
		readFile(resolve(artifactsRoot, "plan.private.json"), "utf8").then((value) => JSON.parse(value) as PlanDocument),
	]);
	await reconcilePlanDocument(planDocument, rows.length, manifest.checksum, report);
};

const fixtureReconcile = async () => {
	const ownerUserId = required("V2_OWNER_USER_ID");
	const outcomes = planRows(businessV1Rows, { ownerUserId });
	const summary = summarize(outcomes);
	const planDocument: PlanDocument = {
		sourceManifestChecksum: stableHash(canonicalJson(businessV1Rows)),
		sourceWatermark: { transaction_id: "sanitized-fixture" },
		outcomes,
		complete: summary.complete,
	};
	await reconcilePlanDocument(planDocument, businessV1Rows.length, planDocument.sourceManifestChecksum, {
		total: businessV1Rows.length,
		accounted: businessV1Rows.length,
		zeroUnexplainedLoss: summary.complete,
	});
};

const assertRollbackSafe = async (
	client: pg.Client,
	entry: { targetTable: string; targetId: string; targetFingerprint: string | null },
) => {
	if (!entry.targetFingerprint) {
		throw new Error("Rollback entry predates target fingerprints and requires manual review.");
	}
	const current = await client.query(
		`SELECT to_jsonb(t) AS row FROM ${safeIdentifier(entry.targetTable)} t WHERE id=$1 FOR UPDATE`,
		[entry.targetId],
	);
	if (!current.rowCount) return;
	const fingerprint = stableHash(canonicalJson(current.rows[0].row));
	if (fingerprint !== entry.targetFingerprint) {
		throw new Error(
			`Rollback blocked: ${entry.targetTable}/${entry.targetId} changed after migration.`,
		);
	}
	const references = (
		await client.query(
			`SELECT child.relname AS "childTable", child_column.attname AS "childColumn"
			 FROM pg_constraint constraint_row
			 JOIN pg_class parent ON parent.oid = constraint_row.confrelid
			 JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
			 JOIN pg_class child ON child.oid = constraint_row.conrelid
			 JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
			 JOIN unnest(constraint_row.conkey) WITH ORDINALITY AS child_key(attnum, ordinality) ON TRUE
			 JOIN unnest(constraint_row.confkey) WITH ORDINALITY AS parent_key(attnum, ordinality)
			   ON parent_key.ordinality = child_key.ordinality
			 JOIN pg_attribute child_column ON child_column.attrelid = child.oid AND child_column.attnum = child_key.attnum
			 JOIN pg_attribute parent_column ON parent_column.attrelid = parent.oid AND parent_column.attnum = parent_key.attnum
			 WHERE constraint_row.contype='f'
			   AND parent_ns.nspname='public'
			   AND child_ns.nspname='public'
			   AND parent.relname=$1
			   AND parent_column.attname='id'`,
			[entry.targetTable],
		)
	).rows as Array<{ childTable: string; childColumn: string }>;
	for (const reference of references) {
		const count = await client.query(
			`SELECT count(*)::int AS count FROM ${safeIdentifier(reference.childTable)} WHERE ${safeIdentifier(reference.childColumn)}=$1`,
			[entry.targetId],
		);
		if (Number(count.rows[0]?.count ?? 0) > 0) {
			throw new Error(
				`Rollback blocked: ${entry.targetTable}/${entry.targetId} has dependent ${reference.childTable} rows.`,
			);
		}
	}
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
				`SELECT "sequence","targetTable","targetId","targetFingerprint" FROM "legacyRollbackEntry" WHERE "runId"=$1 AND "rolledBackAt" IS NULL ORDER BY "sequence" DESC`,
				[runId],
			)
		).rows;
		for (const entry of entries) {
			if (!allowed.has(entry.targetTable))
				throw new Error("Rollback target is not allowlisted");
			await assertRollbackSafe(client, entry);
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
	classify,
	export: exportSource,
	plan,
	apply,
	"fixture-apply": fixtureApply,
	reconcile,
	"fixture-reconcile": fixtureReconcile,
	rollback,
};
if (!command || !commands[command])
	throw new Error(`Unknown command: ${command ?? "<missing>"}`);
await commands[command]();
