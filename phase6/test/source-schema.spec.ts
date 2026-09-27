import { describe, expect, test } from "bun:test";
import { buildExportPolicy, validateExportSchema } from "../src/export-policy";
import { publicColumnsQuery, publicTablesQuery } from "../src/source-schema";

const matrix = await Bun.file("docs/ibl/migration-coverage-matrix.md").text();
const policy = buildExportPolicy(matrix);

describe("restricted V1 schema inspection", () => {
	test("uses PostgreSQL catalogs rather than restricted information_schema columns", () => {
		expect(publicTablesQuery).toContain("pg_catalog.pg_class");
		expect(publicColumnsQuery).toContain("pg_catalog.pg_attribute");
		expect(publicColumnsQuery).toContain("pg_catalog.pg_namespace");
		expect(publicColumnsQuery).not.toContain("information_schema.columns");
	});

	test("catalog metadata and the explicit export policy validate a complete schema", () => {
		const schemaColumns = Object.entries(policy).flatMap(([table, tablePolicy]) =>
			[...tablePolicy.columns, ...Object.keys(tablePolicy.excludedColumns)].map((column) => ({ table, column })),
		);

		expect(() => validateExportSchema(policy, schemaColumns)).not.toThrow();
		expect(schemaColumns.some(({ table, column }) => table === "mailbox_credentials" && column === "encrypted_password")).toBe(true);
	});
});
