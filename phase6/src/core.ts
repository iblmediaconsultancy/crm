import { createHash, randomUUID } from "node:crypto";

export type OutcomeKind = "MAPPED" | "REJECTED" | "DUPLICATE_CANDIDATE";

export interface ExportRow {
	table: string;
	row: Record<string, unknown>;
}

export interface MigrationOutcome {
	idempotencyKey: string;
	sourceTable: string;
	sourceIdHash: string;
	outcome: OutcomeKind;
	targetTable?: string;
	targetId?: string;
	reasonCode?: string;
	payload?: Record<string, unknown>;
}

export const stableHash = (value: string) =>
	createHash("sha256").update(value).digest("hex");

export const canonicalJson = (value: unknown): string => {
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
};

export const sourceIdentity = (table: string, row: Record<string, unknown>) => {
	const raw = String(
		row.id ?? row.entity_id ?? row.external_id ?? canonicalJson(row),
	);
	return {
		idempotencyKey: stableHash(`ibl-v1:${table}:${raw}`),
		sourceIdHash: stableHash(raw),
	};
};

const normalizeName = (value: unknown) =>
	String(value ?? "")
		.trim()
		.toLocaleLowerCase("en")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

const splitName = (value: unknown) => {
	const parts = String(value ?? "")
		.trim()
		.split(/\s+/);
	return {
		firstName: parts.shift() || "Unknown",
		lastName: parts.join(" ") || null,
	};
};

const leadStatus = (value: unknown) => {
	const status = String(value ?? "").toUpperCase();
	if (
		["NEW", "QUALIFIED", "CONTACTED", "CONVERTED", "DISQUALIFIED"].includes(
			status,
		)
	)
		return status;
	return "NEW";
};

export interface PlanContext {
	ownerUserId: string;
	existingFingerprints?: Set<string>;
}

export const planRow = (
	{ table, row }: ExportRow,
	context: PlanContext,
): MigrationOutcome => {
	const identity = sourceIdentity(table, row);
	const reject = (reasonCode: string): MigrationOutcome => ({
		...identity,
		sourceTable: table,
		outcome: "REJECTED",
		reasonCode,
	});
	if (!context.ownerUserId) return reject("MISSING_V2_OWNER");

	if (table === "leads") {
		const name = String(row.name ?? "").trim();
		if (!name) return reject("MISSING_REQUIRED_NAME");
		const fingerprint = `lead:${normalizeName(name)}:${normalizeName(row.organization)}`;
		if (context.existingFingerprints?.has(fingerprint)) {
			return {
				...identity,
				sourceTable: table,
				outcome: "DUPLICATE_CANDIDATE",
				targetTable: "lead",
				reasonCode: "NORMALIZED_NAME_MATCH",
			};
		}
		context.existingFingerprints?.add(fingerprint);
		return {
			...identity,
			sourceTable: table,
			outcome: "MAPPED",
			targetTable: "lead",
			targetId: `legacy_${identity.idempotencyKey.slice(0, 24)}`,
			payload: {
				name,
				status: leadStatus(row.status),
				ownerUserId: context.ownerUserId,
				createdByUserId: context.ownerUserId,
				source: "IMPORT",
				sourceKey: `ibl-v1:leads:${identity.sourceIdHash}`,
				nextActionAt: row.next_follow_up_at ?? null,
			},
		};
	}

	if (table === "templates") {
		if (!String(row.name ?? "").trim() || !String(row.body ?? "").trim())
			return reject("MISSING_TEMPLATE_CONTENT");
		return {
			...identity,
			sourceTable: table,
			outcome: "MAPPED",
			targetTable: "template",
			targetId: `legacy_${identity.idempotencyKey.slice(0, 24)}`,
			payload: {
				name: String(row.name),
				kind: "EMAIL",
				body: String(row.body),
				active: row.active !== false,
				ownerUserId: context.ownerUserId,
				sourceKey: `ibl-v1:templates:${identity.sourceIdHash}`,
			},
		};
	}

	if (table === "proof_items") {
		if (!String(row.title ?? "").trim())
			return reject("MISSING_REQUIRED_TITLE");
		return {
			...identity,
			sourceTable: table,
			outcome: "MAPPED",
			targetTable: "proofItem",
			targetId: `legacy_${identity.idempotencyKey.slice(0, 24)}`,
			payload: {
				label: String(row.title),
				proofType: String(row.proof_type ?? row.category ?? "legacy"),
				reference: row.source_url ?? row.external_url ?? row.file_url ?? null,
				sourceKey: `ibl-v1:proof_items:${identity.sourceIdHash}`,
			},
		};
	}

	if (table === "football_entities") {
		const displayName = String(row.display_name ?? "").trim();
		if (!displayName) return reject("MISSING_REQUIRED_NAME");
		const kind = String(row.entity_kind ?? "").toLowerCase();
		const companyKinds = new Set(["agency", "club", "company", "organization"]);
		const targetTable = companyKinds.has(kind) ? "company" : "contact";
		const fingerprint = `${targetTable}:${normalizeName(displayName)}`;
		if (context.existingFingerprints?.has(fingerprint)) {
			return {
				...identity,
				sourceTable: table,
				outcome: "DUPLICATE_CANDIDATE",
				targetTable,
				reasonCode: "NORMALIZED_NAME_MATCH",
			};
		}
		context.existingFingerprints?.add(fingerprint);
		const name = splitName(displayName);
		return {
			...identity,
			sourceTable: table,
			outcome: "MAPPED",
			targetTable,
			targetId: `legacy_${identity.idempotencyKey.slice(0, 24)}`,
			payload:
				targetTable === "company"
					? {
							name: displayName,
							country: row.country_region ?? null,
							ownerId: context.ownerUserId,
							source: "IMPORT",
						}
					: { ...name, ownerId: context.ownerUserId, source: "IMPORT" },
		};
	}

	return reject("UNSUPPORTED_SOURCE_TABLE");
};

export const planRows = (rows: ExportRow[], context: PlanContext) => {
	const fingerprints = context.existingFingerprints ?? new Set<string>();
	return rows.map((row) =>
		planRow(row, { ...context, existingFingerprints: fingerprints }),
	);
};

export const summarize = (outcomes: MigrationOutcome[]) => {
	const byOutcome = { MAPPED: 0, REJECTED: 0, DUPLICATE_CANDIDATE: 0 };
	const byReason: Record<string, number> = {};
	for (const outcome of outcomes) {
		byOutcome[outcome.outcome] += 1;
		if (outcome.reasonCode)
			byReason[outcome.reasonCode] = (byReason[outcome.reasonCode] ?? 0) + 1;
	}
	return {
		total: outcomes.length,
		byOutcome,
		byReason,
		accounted: outcomes.length,
	};
};

export const newRunId = () => `v1_${randomUUID()}`;
