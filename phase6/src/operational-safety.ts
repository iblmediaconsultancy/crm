import { canonicalJson, sourceIdentity, stableHash, type ExportRow } from "./core";

export type SnapshotWatermark = {
	transaction_id: string;
	captured_at: string;
	snapshot_id: string;
};

export type SnapshotBoundary = {
	mode: "SNAPSHOT" | "DELTA";
	fromWatermark?: SnapshotWatermark;
	toWatermark: SnapshotWatermark;
	baseManifestChecksum?: string;
};

export type DeltaOperation = "UPSERT" | "DELETE";

export type DeltaRow = {
	table: string;
	operation: DeltaOperation;
	row: Record<string, unknown>;
	sourceId: string;
};

export type DeltaDocument = {
	formatVersion: 1;
	boundary: SnapshotBoundary;
	rows: DeltaRow[];
	checksum: string;
};

const rowId = (item: ExportRow) =>
	String(item.row.id ?? item.row.entity_id ?? item.row.external_id ?? canonicalJson(item.row));

const rowKey = (item: ExportRow) => `${item.table}:${rowId(item)}`;

const sortedRows = (rows: ExportRow[]) =>
	[...rows].sort((left, right) => rowKey(left).localeCompare(rowKey(right)));

export const snapshotBoundary = (
	transactionId: string,
	capturedAt: string,
	snapshotId = `${transactionId}:${capturedAt}`,
): SnapshotBoundary => ({
	mode: "SNAPSHOT",
	toWatermark: {
		transaction_id: transactionId,
		captured_at: capturedAt,
		snapshot_id: snapshotId,
	},
});

export const deltaBoundary = (
	fromWatermark: SnapshotWatermark,
	toWatermark: SnapshotWatermark,
	baseManifestChecksum: string,
): SnapshotBoundary => {
	if (fromWatermark.snapshot_id === toWatermark.snapshot_id) {
		throw new Error("Delta watermark must advance beyond its base snapshot");
	}
	return {
		mode: "DELTA",
		fromWatermark,
		toWatermark,
		baseManifestChecksum,
	};
};

export const buildDelta = (
	baseRows: ExportRow[],
	currentRows: ExportRow[],
	boundary: SnapshotBoundary,
): DeltaDocument => {
	if (boundary.mode !== "DELTA" || !boundary.baseManifestChecksum) {
		throw new Error("Delta export requires a base snapshot manifest checksum");
	}
	const base = new Map(baseRows.map((item) => [rowKey(item), item]));
	const current = new Map(currentRows.map((item) => [rowKey(item), item]));
	const rows: DeltaRow[] = [];
	for (const item of sortedRows(currentRows)) {
		const key = rowKey(item);
		const previous = base.get(key);
		if (!previous || canonicalJson(previous.row) !== canonicalJson(item.row)) {
			rows.push({ table: item.table, operation: "UPSERT", row: item.row, sourceId: rowId(item) });
		}
	}
	for (const item of sortedRows(baseRows)) {
		if (!current.has(rowKey(item))) {
			rows.push({ table: item.table, operation: "DELETE", row: {}, sourceId: rowId(item) });
		}
	}
	const unsigned = { formatVersion: 1 as const, boundary, rows };
	return { ...unsigned, checksum: stableHash(canonicalJson(unsigned)) };
};

export const replayDelta = (baseRows: ExportRow[], delta: DeltaDocument) => {
	if (delta.checksum !== stableHash(canonicalJson({
		formatVersion: delta.formatVersion,
		boundary: delta.boundary,
		rows: delta.rows,
	}))) throw new Error("Delta checksum mismatch");
	const result = new Map(baseRows.map((item) => [rowKey(item), item]));
	for (const change of delta.rows) {
		const item = { table: change.table, row: change.row };
		const key = `${change.table}:${change.sourceId}`;
		if (change.operation === "DELETE") result.delete(key);
		else result.set(key, item);
	}
	return sortedRows([...result.values()]);
};

export const fingerprintSnapshot = (rows: ExportRow[], boundary: SnapshotBoundary) =>
	stableHash(canonicalJson({ boundary, rows: sortedRows(rows) }));

export const fingerprintPlan = (plan: unknown) => stableHash(canonicalJson(plan));

export const fingerprintAppliedResult = (result: unknown) => stableHash(canonicalJson(result));

export const sourceRowFingerprint = (table: string, row: Record<string, unknown>) =>
	stableHash(canonicalJson({ table, identity: sourceIdentity(table, row), row }));

export const reconciliationPassed = (checks: {
	manifestChecksumMatches: boolean;
	classificationComplete: boolean;
	zeroUnexplainedLoss: boolean;
	targetReconciled: boolean;
}) =>
	checks.manifestChecksumMatches &&
	checks.classificationComplete &&
	checks.zeroUnexplainedLoss &&
	checks.targetReconciled;
