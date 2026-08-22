import { canonicalJson, stableHash } from "./core";

export const EXPECTED_V1_TABLES = [
	"ai_proposal_items",
	"ai_proposals",
	"allocation_entity_exclusions",
	"analytics_events",
	"app_schema_capabilities",
	"audit_logs",
	"calendar_invite_helpers",
	"contact_logs",
	"contact_routes",
	"contact_safety_checks",
	"dashboard_metric_snapshots",
	"duplicate_candidates",
	"duplicate_change_log",
	"duplicate_entity_pairs",
	"duplicate_groups",
	"duplicate_jobs",
	"duplicate_merge_audit",
	"duplicate_review_audit",
	"duplicate_review_comments",
	"duplicate_scan_state",
	"email_attachments",
	"email_events",
	"email_messages",
	"email_threads",
	"entity_fingerprints",
	"football_contact_routes",
	"football_entities",
	"football_entity_aliases",
	"football_entity_contact_routes",
	"football_field_provenance",
	"football_import_batches",
	"football_import_change_proposals",
	"football_import_external_refs",
	"football_import_ledger",
	"football_lead_links",
	"football_merge_history",
	"football_organization_details",
	"football_outreach_cycles",
	"football_outreach_queue",
	"football_person_details",
	"football_player_details",
	"football_promotion_audit",
	"football_relationships",
	"football_route_external_ids",
	"football_shared_contact_routes",
	"football_source_records",
	"imports",
	"in_app_notifications",
	"lead_activity_events",
	"lead_allocation_runs",
	"lead_candidate_scores",
	"lead_pack_duplicate_flag_audit",
	"lead_pack_duplicate_flags",
	"lead_pack_item_actions",
	"lead_pack_items",
	"lead_packs",
	"leads",
	"mailbox_connections",
	"mailbox_credentials",
	"mailbox_sync_runs",
	"manual_communication_drafts",
	"notification_preferences",
	"phone_call_notes",
	"profiles",
	"proof_items",
	"relationship_bundles",
	"reply_classifications",
	"research_findings",
	"research_requests",
	"saved_ai_outputs",
	"saved_email_drafts",
	"saved_searches",
	"tasks",
	"templates",
	"user_work_preferences",
] as const;

export type ExportDisposition =
	| "BUSINESS"
	| "CONTROL_ONLY"
	| "INTENTIONAL_EXCLUSION"
	| "METADATA_ONLY";

export type ExportTablePolicy = {
	disposition: ExportDisposition;
	columns: string[];
	excludedColumns: Record<string, string>;
};

export type ExportPolicy = Record<string, ExportTablePolicy>;

const sensitiveColumnPattern = /(^|_)(password|password_hash|encrypted_password|encrypted_secret|api_key|secret|session|token|oauth_token|access_token|refresh_token|iv|auth_tag|credential|credentials|encryption_key|encryption_material)(_|$)/i;

const additionalSensitiveColumns: Record<string, string[]> = {
	email_messages: ["provider_payload"],
	football_import_change_proposals: ["incoming_record", "current_record", "field_differences"],
	football_import_external_refs: ["raw_record"],
	football_route_external_ids: ["raw_record"],
	football_source_records: ["raw_record"],
};

const isSensitiveColumn = (table: string, column: string) =>
	sensitiveColumnPattern.test(column) || additionalSensitiveColumns[table]?.includes(column) === true;

const exclusionReason = (table: string, column: string, status: string) =>
	isSensitiveColumn(table, column)
		? "SECRET_NOT_EXPORTED"
		: table === "mailbox_credentials"
			? "CREDENTIAL_METADATA_ONLY"
			: status.toLowerCase().startsWith("control-only")
				? "CONTROL_ONLY"
				: "INTENTIONALLY_EXCLUDED";

const parseFields = (value: string): string[] =>
	[...value.matchAll(/`([^`]+)`/g)]
		.map((match) => match[1])
		.filter((field): field is string => Boolean(field));

export const buildExportPolicy = (
	matrixMarkdown: string,
	expectedTables: readonly string[] = EXPECTED_V1_TABLES,
): ExportPolicy => {
	const policy: ExportPolicy = {};
	for (const line of matrixMarkdown.split("\n")) {
		const match = line.match(/^\| `([^`]+)` \| ([^|]+) \| (.*?) \| (.*?) \| (.*?) \|$/);
		if (!match) continue;
		const table = match[1];
		const fieldCell = match[3];
		const statusCell = match[5];
		if (!table || !fieldCell || !statusCell) throw new Error("Malformed migration matrix row");
		if (policy[table]) throw new Error(`Duplicate migration matrix table: ${table}`);
		const fields = parseFields(fieldCell);
		if (!fields.length) throw new Error(`Migration matrix has no fields for ${table}`);
		const status = statusCell.trim();
		const disposition: ExportDisposition = table === "mailbox_credentials"
			? "METADATA_ONLY"
			: status.toLowerCase().startsWith("control-only")
			? "CONTROL_ONLY"
			: status.toLowerCase().startsWith("intentional exclusion")
				? "INTENTIONAL_EXCLUSION"
				: "BUSINESS";
		const excludedColumns: Record<string, string> = {};
		let columns = fields;
		if (disposition === "CONTROL_ONLY" || disposition === "INTENTIONAL_EXCLUSION") {
			columns = [];
			for (const field of fields) excludedColumns[field] = exclusionReason(table, field, status);
		} else if (disposition === "METADATA_ONLY") {
			columns = fields.filter((field) => ["mailbox_id", "updated_at"].includes(field));
			for (const field of fields) {
				if (!columns.includes(field)) excludedColumns[field] = exclusionReason(table, field, status);
			}
		} else {
			columns = fields.filter((field) => {
				if (!isSensitiveColumn(table, field)) return true;
				excludedColumns[field] = "SECRET_NOT_EXPORTED";
				return false;
			});
		}
		policy[table] = { disposition, columns, excludedColumns };
	}
	const expected = new Set(expectedTables);
	const actual = new Set(Object.keys(policy));
	const missing = expectedTables.filter((table) => !actual.has(table));
	const unexpected = Object.keys(policy).filter((table) => !expected.has(table));
	if (missing.length || unexpected.length || actual.size !== expected.size) {
		throw new Error(`Migration matrix table set mismatch. Missing: ${missing.join(",")}. Unexpected: ${unexpected.join(",")}.`);
	}
	return policy;
};

export const validateExportSchema = (
	policy: ExportPolicy,
	actual: Array<{ table: string; column: string }>,
) => {
	const actualTables = new Set(actual.map((item) => item.table));
	const policyTables = new Set(Object.keys(policy));
	const unknownTables = [...actualTables].filter((table) => !policyTables.has(table));
	const missingTables = [...policyTables].filter((table) => !actualTables.has(table));
	if (unknownTables.length || missingTables.length) {
		throw new Error(`V1 export table policy mismatch. Unknown: ${unknownTables.join(",")}. Missing: ${missingTables.join(",")}.`);
	}
	for (const table of Object.keys(policy).sort()) {
		const tablePolicy = policy[table];
		if (!tablePolicy) throw new Error(`Missing V1 export policy for table ${table}`);
		const actualColumns = new Set(actual.filter((item) => item.table === table).map((item) => item.column));
		const expectedColumns = new Set([...tablePolicy.columns, ...Object.keys(tablePolicy.excludedColumns)]);
		const unknownColumns = [...actualColumns].filter((column) => !expectedColumns.has(column));
		const missingColumns = [...expectedColumns].filter((column) => !actualColumns.has(column));
		if (unknownColumns.length || missingColumns.length) {
			throw new Error(`V1 export column policy mismatch for ${table}. Unknown: ${unknownColumns.join(",")}. Missing: ${missingColumns.join(",")}.`);
		}
	}
};

export const projectExportRow = (
	policy: ExportPolicy,
	table: string,
	row: Record<string, unknown>,
) => {
	const tablePolicy = policy[table];
	if (!tablePolicy) throw new Error(`No V1 export policy for table ${table}`);
	const declared = new Set([...tablePolicy.columns, ...Object.keys(tablePolicy.excludedColumns)]);
	const unknownColumns = Object.keys(row).filter((column) => !declared.has(column));
	if (unknownColumns.length) throw new Error(`Unexpected V1 export columns for ${table}: ${unknownColumns.join(",")}`);
	return Object.fromEntries(tablePolicy.columns.filter((column) => column in row).map((column) => [column, row[column]]));
};

export const manifestFingerprint = (manifest: unknown) => stableHash(canonicalJson(manifest));
