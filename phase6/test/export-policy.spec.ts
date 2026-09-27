import { describe, expect, test } from "bun:test";
import {
	buildExportPolicy,
	EXPECTED_V1_TABLES,
	manifestFingerprint,
	projectExportRow,
	validateExportSchema,
} from "../src/export-policy";

const matrix = await Bun.file("docs/ibl/migration-coverage-matrix.md").text();
const policy = buildExportPolicy(matrix);

const schemaColumns = Object.entries(policy).flatMap(([table, tablePolicy]) =>
	tablePolicy.columns.map((column) => ({ table, column })),
);

describe("V1 export policy", () => {
	test("covers every authoritative table and never exports secret columns", () => {
		expect(Object.keys(policy)).toHaveLength(82);
		expect(Object.keys(policy)).toEqual([...EXPECTED_V1_TABLES]);
		expect(policy.mailbox_credentials?.columns).toEqual(["mailbox_id", "updated_at"]);
		expect(policy.mailbox_credentials?.columns).not.toContain("encrypted_password");
		expect(policy.mailbox_credentials?.columns).not.toContain("iv");
		expect(policy.mailbox_credentials?.columns).not.toContain("auth_tag");
		expect(policy.email_messages?.columns).not.toContain("provider_payload");
	});

	test("projects approved business data and omits secret-bearing values", () => {
		expect(projectExportRow(policy, "mailbox_credentials", {
		mailbox_id: "mailbox-1",
		updated_at: "2026-08-22T12:00:00.000Z",
		encrypted_password: "secret",
		iv: "secret",
		auth_tag: "secret",
	})).toEqual({
		mailbox_id: "mailbox-1",
		updated_at: "2026-08-22T12:00:00.000Z",
	});
		expect(projectExportRow(policy, "leads", {
			id: "lead-1",
			name: "Fixture Lead",
			status: "QUALIFIED",
			owner_id: "profile-1",
		})).toEqual({
			id: "lead-1",
			name: "Fixture Lead",
			status: "QUALIFIED",
			owner_id: "profile-1",
		});
	});

	test("refuses unexpected tables and columns", () => {
		expect(() => validateExportSchema(policy, [...schemaColumns, { table: "new_table", column: "id" }])).toThrow(/Unknown/);
		expect(() => validateExportSchema(policy, [...schemaColumns, { table: "leads", column: "new_column" }])).toThrow(/Unknown/);
	});

	test("keeps manifest fingerprints deterministic", () => {
		const manifest = {
			formatVersion: 1,
			policyFingerprint: manifestFingerprint(policy),
			files: [{ table: "leads", columns: ["id", "name"], excludedColumns: { api_key: "SECRET_NOT_EXPORTED" } }],
		};
		expect(manifestFingerprint(manifest)).toBe(manifestFingerprint(manifest));
		expect(manifestFingerprint({ ...manifest, files: [...manifest.files] })).toBe(manifestFingerprint(manifest));
	});
});
