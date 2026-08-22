import { describe, expect, test } from "bun:test";
import { buildExportPolicy } from "../src/export-policy";

const matrix = await Bun.file("docs/ibl/migration-coverage-matrix.md").text();
const policy = buildExportPolicy(matrix);
const setupSql = await Bun.file("phase6/v1-readonly-role.sql").text();
const verificationSql = await Bun.file("phase6/v1-readonly-role-verification.sql").text();
const cliSource = await Bun.file("phase6/src/cli.ts").text();
const grantMatches = [...setupSql.matchAll(/^GRANT SELECT \((.*?)\) ON TABLE public\.([a-z_][a-z0-9_]*) TO ibl_v1_migration_exporter;$/gm)];
const sensitiveColumnPattern = /(^|_)(password|password_hash|encrypted_password|encrypted_secret|api_key|secret|session|token|oauth_token|access_token|refresh_token|iv|auth_tag|credential|credentials|encryption_key|encryption_material)(_|$)/i;
const additionalSensitiveColumns: Record<string, string[]> = {
	email_messages: ["provider_payload"],
	football_import_change_proposals: ["incoming_record", "current_record", "field_differences"],
	football_import_external_refs: ["raw_record"],
	football_route_external_ids: ["raw_record"],
	football_source_records: ["raw_record"],
};

const grantedColumns = new Map<string, string[]>(grantMatches.map((match) => {
	const table = match[2];
	const columnList = match[1];
	if (!table || !columnList) throw new Error("Malformed restricted-role grant");
	return [table, [...columnList.matchAll(/"([^"]+)"/g)].flatMap((column) => column[1] ? [column[1]] : [])];
}));

describe("restricted V1 role SQL", () => {
	test("has one explicit public-table grant for every inventoried table", () => {
		expect(grantMatches).toHaveLength(75);
		expect([...grantedColumns.keys()].sort()).toEqual(Object.keys(policy).sort());
	});

	test("matches the export policy and grants safe metadata for non-exported tables", () => {
		for (const [table, tablePolicy] of Object.entries(policy)) {
			const expected = tablePolicy.columns.length
				? tablePolicy.columns
				: Object.keys(tablePolicy.excludedColumns).find((column) =>
					!sensitiveColumnPattern.test(column) && !additionalSensitiveColumns[table]?.includes(column),
				) ? [Object.keys(tablePolicy.excludedColumns).find((column) =>
					!sensitiveColumnPattern.test(column) && !additionalSensitiveColumns[table]?.includes(column),
				) as string] : [];
			expect(grantedColumns.get(table)).toEqual(expected);
		}
		expect(grantedColumns.get("mailbox_credentials")).toEqual(["mailbox_id", "updated_at"]);
	});

	test("never grants secret-bearing columns or broad table access", () => {
		const grantText = grantMatches.map((match) => match[0]).join("\n");
		expect(grantText).not.toMatch(/GRANT SELECT ON ALL TABLES/i);
		for (const [table, columns] of grantedColumns) {
			for (const column of columns) {
				expect(sensitiveColumnPattern.test(column)).toBe(false);
				expect(additionalSensitiveColumns[table]?.includes(column) ?? false).toBe(false);
			}
		}
		expect(setupSql).toContain("NOBYPASSRLS");
		expect(setupSql).toContain("NOCREATEDB");
		expect(setupSql).toContain("NOCREATEROLE");
		expect(setupSql).toContain("NOREPLICATION");
		expect(setupSql).not.toContain("GRANT USAGE ON SCHEMA auth");
		expect(setupSql).toContain("has_schema_privilege('public'::name, 'auth', 'USAGE')");
		expect(setupSql).toContain("has_sequence_privilege('public'::name");
		expect(setupSql).toContain("public_can_create_temp_informational");
		expect(setupSql).toContain("PUBLIC_EXECUTABLE_USER_DEFINED_FUNCTION");
		expect(setupSql).not.toContain("REVOKE ALL PRIVILEGES ON DATABASE postgres FROM PUBLIC");
		const blockingSection = setupSql.slice(setupSql.indexOf("DO $$"), setupSql.indexOf("CREATE ROLE"));
		expect(blockingSection).not.toContain("current_database(), 'TEMP'");
		expect(cliSource).not.toMatch(/CREATE\s+TEMP|TEMPORARY\s+TABLE/i);
	});

	test("verification block checks role attributes, inherited privileges, reads, secrets, and RLS", () => {
		expect(verificationSql).toContain("rolsuper");
		expect(verificationSql).toContain("rolcreatedb");
		expect(verificationSql).toContain("rolcreaterole");
		expect(verificationSql).toContain("rolbypassrls");
		expect(verificationSql).toContain("rolreplication");
		expect(verificationSql).toContain("transaction_read_only");
		expect(verificationSql).toContain("relrowsecurity");
		expect(verificationSql).toContain("provider_payload");
		expect(verificationSql).toContain("encrypted_password");
		expect(verificationSql).toContain("has_column_privilege");
		expect(verificationSql).toContain("has_sequence_privilege");
		expect(verificationSql).toContain("inherited_temp_allowed");
		expect(verificationSql).toContain("public_temp_informational");
	});
});
