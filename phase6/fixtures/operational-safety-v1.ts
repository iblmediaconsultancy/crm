import type { ExportRow } from "../src/core";

export const operationalSafetyRows: ExportRow[] = [
	{
		table: "profiles",
		row: {
			id: "operational-safety-profile-1",
			email: "operational-safety@example.test",
			full_name: "Operational Safety Owner",
			role: "MEMBER",
			active: true,
		},
	},
	{
		table: "leads",
		row: {
			id: "operational-safety-lead-1",
			name: "Operational Safety Lead",
			organization: "Operational Safety Fixture",
			status: "NEW",
			owner_id: "operational-safety-profile-1",
			created_at: "2026-08-22T12:00:00.000Z",
			updated_at: "2026-08-22T12:00:00.000Z",
		},
	},
];

export const operationalSafetyUpdatedRows: ExportRow[] = operationalSafetyRows.map((item) =>
	item.table === "leads"
		? { ...item, row: { ...item.row, name: "Operational Safety Lead Updated", updated_at: "2026-08-22T13:00:00.000Z" } }
		: item,
);
