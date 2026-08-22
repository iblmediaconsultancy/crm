import { createHash, randomUUID } from "node:crypto";

export type OutcomeKind =
	| "MAPPED"
	| "REJECTED"
	| "DUPLICATE_CANDIDATE"
	| "EXCLUDED";

export interface ExportRow {
	table: string;
	row: Record<string, unknown>;
}

export interface FieldCoverage {
	mapped: string[];
	intentionallyExcluded: Record<string, string>;
	unsupported: Record<string, string>;
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
	fieldCoverage?: FieldCoverage;
}

export interface PlanContext {
	ownerUserId: string;
	existingFingerprints?: Set<string>;
	ownerMap?: Record<string, string>;
}

type MappingDefinition = {
	targetTable: string;
	ownerRequired?: boolean;
};

const STATIC_MAPPINGS: Record<string, MappingDefinition> = {
	ai_proposal_items: { targetTable: "proposalItem" },
	ai_proposals: { targetTable: "proposal", ownerRequired: true },
	allocation_entity_exclusions: { targetTable: "allocationRequest" },
	audit_logs: { targetTable: "domainAuditEvent" },
	calendar_invite_helpers: { targetTable: "calendarEvent" },
	contact_logs: { targetTable: "activity", ownerRequired: true },
	contact_routes: { targetTable: "contactRoute", ownerRequired: true },
	contact_safety_checks: { targetTable: "contactRouteConsent" },
	duplicate_candidates: { targetTable: "duplicateCandidate" },
	duplicate_change_log: { targetTable: "lifecycleEvent" },
	duplicate_entity_pairs: { targetTable: "duplicateCandidate" },
	duplicate_groups: { targetTable: "duplicateCandidate" },
	duplicate_merge_audit: { targetTable: "mergeDecision", ownerRequired: true },
	duplicate_review_audit: { targetTable: "duplicateCandidate" },
	duplicate_review_comments: { targetTable: "note", ownerRequired: true },
	email_attachments: { targetTable: "messageAttachment" },
	email_events: { targetTable: "outreachEvent" },
	email_messages: { targetTable: "emailMessage" },
	email_threads: { targetTable: "emailThread" },
	football_contact_routes: { targetTable: "contactRoute", ownerRequired: true },
	football_entity_aliases: { targetTable: "canonicalAlias", ownerRequired: true },
	football_entity_contact_routes: { targetTable: "contactRoute", ownerRequired: true },
	football_field_provenance: { targetTable: "evidenceSource" },
	football_import_change_proposals: { targetTable: "proposal", ownerRequired: true },
	football_import_external_refs: { targetTable: "legacyIdMap" },
	football_lead_links: { targetTable: "lifecycleEvent" },
	football_merge_history: { targetTable: "mergeDecision", ownerRequired: true },
	football_organization_details: { targetTable: "companyEnrichment" },
	football_outreach_cycles: { targetTable: "lifecycleEvent" },
	football_outreach_queue: { targetTable: "allocationRequest" },
	football_person_details: { targetTable: "contactFact" },
	football_player_details: { targetTable: "contactFact" },
	football_promotion_audit: { targetTable: "lifecycleEvent" },
	football_relationships: { targetTable: "representation", ownerRequired: true },
	football_route_external_ids: { targetTable: "contactRoute", ownerRequired: true },
	football_shared_contact_routes: { targetTable: "sharedRoutePolicy", ownerRequired: true },
	football_source_records: { targetTable: "evidenceSource" },
	lead_activity_events: { targetTable: "lifecycleEvent" },
	lead_allocation_runs: { targetTable: "allocationRequest" },
	lead_candidate_scores: { targetTable: "allocationRequest" },
	lead_pack_duplicate_flag_audit: { targetTable: "duplicateCandidate" },
	lead_pack_duplicate_flags: { targetTable: "duplicateCandidate" },
	lead_pack_item_actions: { targetTable: "lifecycleEvent" },
	lead_pack_items: { targetTable: "allocationRequest" },
	lead_packs: { targetTable: "allocationRequest" },
	leads: { targetTable: "lead", ownerRequired: true },
	mailbox_connections: { targetTable: "mailbox", ownerRequired: true },
	mailbox_sync_runs: { targetTable: "mailboxSync", ownerRequired: true },
	manual_communication_drafts: { targetTable: "draft", ownerRequired: true },
	notification_preferences: { targetTable: "userProfile" },
	phone_call_notes: { targetTable: "activity", ownerRequired: true },
	profiles: { targetTable: "user" },
	proof_items: { targetTable: "proofItem" },
	relationship_bundles: { targetTable: "lifecycleEvent" },
	reply_classifications: { targetTable: "activity", ownerRequired: true },
	research_findings: { targetTable: "researchFinding" },
	research_requests: { targetTable: "researchRequest", ownerRequired: true },
	saved_ai_outputs: { targetTable: "domainAuditEvent", ownerRequired: true },
	saved_email_drafts: { targetTable: "draft", ownerRequired: true },
	tasks: { targetTable: "operationalTask", ownerRequired: true },
	templates: { targetTable: "template" },
	user_work_preferences: { targetTable: "userProfile" },
};

const PLATFORM_EXCLUSIONS: Record<string, string> = {
	analytics_events: "DERIVED_TELEMETRY",
	app_schema_capabilities: "PLATFORM_SCHEMA_STATE",
	dashboard_metric_snapshots: "DERIVED_METRICS",
	duplicate_jobs: "REBUILDABLE_DEDUP_JOB_STATE",
	duplicate_scan_state: "REBUILDABLE_DEDUP_SCAN_STATE",
	entity_fingerprints: "REBUILDABLE_ENTITY_FINGERPRINTS",
	football_import_batches: "SOURCE_IMPORT_CONTROL_ONLY",
	football_import_ledger: "SOURCE_IMPORT_CONTROL_ONLY",
	in_app_notifications: "TRANSIENT_UI_NOTIFICATION",
	imports: "SOURCE_IMPORT_CONTROL_ONLY",
	mailbox_credentials: "SECRET_NOT_MIGRATED",
};

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

const sourceId = (row: Record<string, unknown>) =>
	String(row.id ?? row.entity_id ?? row.external_id ?? canonicalJson(row));

const targetIdFor = (table: string, id: string) =>
	`legacy_${stableHash(`ibl-v1:${table}:${id}`).slice(0, 24)}`;

export const targetIdForTest = targetIdFor;

const sourceKeyFor = (table: string, sourceIdHash: string) =>
	`ibl-v1:${table}:${sourceIdHash}`;

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
	if (status === "LOST") return "DISQUALIFIED";
	return "NEW";
};

const mappingFor = (table: string, row: Record<string, unknown>) => {
	if (table === "football_entities") {
		const kind = String(row.entity_kind ?? "").toLowerCase();
		return {
			targetTable: ["agency", "club", "company", "organization"].includes(kind)
				? "company"
				: "contact",
			ownerRequired: false,
		};
	}
	if (table === "football_person_details") {
		return {
			targetTable: String(row.role_title ?? "").toLowerCase().includes("player")
				? "footballPlayer"
				: "footballAgent",
			ownerRequired: false,
		};
	}
	if (table === "football_player_details") {
		return { targetTable: "footballPlayer", ownerRequired: false };
	}
	if (table === "football_organization_details") {
		return {
			targetTable: String(row.organization_type ?? "").toLowerCase().includes("club")
				? "club"
				: "agency",
			ownerRequired: false,
		};
	}
	return STATIC_MAPPINGS[table];
};

const parentTargetId = (row: Record<string, unknown>) => {
	const parentId = row.entity_id ?? row.canonical_entity_id ?? row.lead_id;
	return parentId ? targetIdFor("football_entities", String(parentId)) : null;
};

const persistedTargetId = (
	table: string,
	targetTable: string,
	row: Record<string, unknown>,
) => {
	const source = sourceId(row);
	if (["footballPlayer", "footballAgent", "agency", "club"].includes(targetTable)) {
		return targetIdFor("football_entities", String(row.entity_id ?? source));
	}
	if (targetTable === "userProfile") {
		return targetIdFor(
			"profiles",
			String(row.user_id ?? row.owner_id ?? row.owner ?? source),
		);
	}
	if (targetTable === "contactRoute" && row.contact_route_id) {
		return targetIdFor("contact_routes", String(row.contact_route_id));
	}
	return targetIdFor(table, source);
};

const ownerSourceId = (row: Record<string, unknown>) =>
	row.owner_id ??
	row.owner ??
	row.assigned_to ??
	row.created_by ??
	row.requested_by ??
	row.approved_by ??
	row.actor_id ??
	row.linked_by ??
	row.checked_by ??
	row.researcher_id ??
	row.merged_by ??
	row.reviewed_by ??
	row.user_id ??
	row.scored_for_user_id;

const resolveOwner = (
	row: Record<string, unknown>,
	context: PlanContext,
) => {
	const sourceOwner = ownerSourceId(row);
	if (sourceOwner === undefined || sourceOwner === null || sourceOwner === "") {
		return context.ownerUserId || null;
	}
	return context.ownerMap?.[String(sourceOwner)] ?? null;
};

const targetFieldsFor = (
	table: string,
	row: Record<string, unknown>,
	context: PlanContext,
	identity: ReturnType<typeof sourceIdentity>,
) => {
	const ownerId = resolveOwner(row, context);
	const sourceKey = sourceKeyFor(table, identity.sourceIdHash);
	const timestamps = {
		createdAt: row.created_at ?? null,
		updatedAt: row.updated_at ?? row.created_at ?? null,
	};

	if (table === "profiles") {
		return {
			name: String(row.full_name ?? "Unknown"),
			email: String(row.email ?? ""),
			emailVerified: false,
			sourceKey,
			...timestamps,
		};
	}
	if (table === "user_work_preferences" || table === "notification_preferences") {
		return {
			userId: ownerId,
			status: "ACTIVE",
			preferredLanguage: row.language_proficiencies ?? "English",
			locale: row.locale ?? "en",
			timeZone: row.timezone ?? "Europe/Amsterdam",
			workingPreferences: row,
			...timestamps,
		};
	}
	if (table === "leads") {
		return {
			name: String(row.name ?? ""),
			leadType: row.lead_type ?? null,
			organization: row.organization ?? null,
			country: row.country ?? null,
			market: row.market ?? null,
			priority: row.priority ?? null,
			status: leadStatus(row.status),
			ownerUserId: ownerId,
			assignedToUserId: context.ownerMap?.[String(row.assigned_to ?? "")] ?? null,
			source: row.source ?? "IMPORT",
			tags: row.tags ?? [],
			notes: row.notes ?? null,
			lastContactAt: row.last_contact_at ?? null,
			nextActionAt: row.next_follow_up_at ?? null,
			...timestamps,
		};
	}
	if (table === "football_entities") {
		const kind = String(row.entity_kind ?? "").toLowerCase();
		const name = splitName(row.display_name);
		return ["agency", "club", "company", "organization"].includes(kind)
			? {
					name: row.display_name,
					country: row.country_region ?? null,
					ownerId,
					source: "IMPORT",
					...timestamps,
				}
			: {
					...name,
					ownerId,
					source: "IMPORT",
					...timestamps,
			};
	}
	if (table === "football_relationships") {
		return {
			playerContactId: row.to_entity_id
				? targetIdFor("football_entities", String(row.to_entity_id))
				: null,
			agentContactId: row.from_entity_id
				? targetIdFor("football_entities", String(row.from_entity_id))
				: null,
			agencyCompanyId: row.agency_entity_id
				? targetIdFor("football_entities", String(row.agency_entity_id))
				: null,
			status: String(row.relationship_type ?? "PENDING").toUpperCase(),
			createdByUserId: ownerId,
			startedAt: row.started_at ?? null,
			endedAt: row.ended_at ?? null,
		};
	}
	if (table === "contact_routes" || table === "football_contact_routes") {
		return {
			contactId: row.contact_id
				? targetIdFor("football_entities", String(row.contact_id))
				: row.entity_id
					? targetIdFor("football_entities", String(row.entity_id))
					: null,
			companyId: row.company_id
				? targetIdFor("football_entities", String(row.company_id))
				: null,
			ownerUserId: ownerId,
			type: String(row.route_type ?? "EMAIL").toUpperCase(),
			value: String(row.value ?? row.route_value ?? ""),
			normalizedValue: normalizeName(row.value ?? row.route_value),
			label: row.contact_role ?? row.label_verification ?? null,
			verifiedAt: row.last_verified ?? null,
			...timestamps,
		};
	}
	if (table === "tasks") {
		return {
			title: String(row.title ?? "Imported task"),
			description: row.description ?? null,
			status: String(row.status ?? "TODO").toUpperCase(),
			priority: String(row.priority ?? "NORMAL").toUpperCase(),
			assigneeUserId: context.ownerMap?.[String(row.assigned_to ?? "")] ?? ownerId,
			createdByUserId: context.ownerMap?.[String(row.created_by ?? "")] ?? ownerId,
			leadId: row.lead_id ? targetIdFor("leads", String(row.lead_id)) : null,
			dueAt: row.due_at ?? null,
			completedAt: row.completed_at ?? null,
			...timestamps,
		};
	}
	if (table === "templates") {
		return {
			name: String(row.name ?? ""),
			kind: String(row.channel ?? "EMAIL").toUpperCase(),
			subject: row.subject ?? null,
			body: String(row.body ?? ""),
			active: row.active !== false,
			ownerUserId: ownerId,
			...timestamps,
		};
	}
	if (table === "proof_items") {
		return {
			label: String(row.title ?? ""),
			proofType: String(row.proof_type ?? row.category ?? "legacy"),
			reference: row.source_url ?? row.external_url ?? row.file_url ?? null,
			createdAt: row.created_at ?? null,
			updatedAt: row.updated_at ?? row.created_at ?? null,
		};
	}
	if (table === "email_threads") {
		return {
			id: targetIdFor(table, sourceId(row)),
			threadKey: row.thread_key,
			mailboxId: row.mailbox_id
				? targetIdFor("mailbox_connections", String(row.mailbox_id))
				: null,
			leadId: row.lead_id ? targetIdFor("leads", String(row.lead_id)) : null,
			subject: row.subject ?? null,
			participants: row.participants ?? [],
			firstMessageAt: row.first_message_at ?? null,
			lastMessageAt: row.last_message_at ?? null,
		};
	}
	if (table === "email_messages") {
		return {
			threadId: row.thread_id ? targetIdFor("email_threads", String(row.thread_id)) : null,
			mailboxId: row.mailbox_id
				? targetIdFor("mailbox_connections", String(row.mailbox_id))
				: null,
			rfcMessageId: row.message_id,
			direction: String(row.direction ?? "INBOUND").toUpperCase(),
			fromEmail: row.from_email,
			fromName: row.from_name ?? null,
			recipients: { to: row.to_emails ?? [], cc: row.cc_emails ?? [], bcc: row.bcc_emails ?? [] },
			subject: row.subject ?? null,
			snippet: row.snippet ?? null,
			body: row.text_body ?? row.html_body ?? null,
			sentAt: row.sent_at ?? row.received_at,
		};
	}
	if (table === "research_requests") {
		return {
			ownerUserId: ownerId,
			mailboxId: row.mailbox_id ?? null,
			targetType: "LEAD",
			targetEntityId: row.lead_id ? targetIdFor("leads", String(row.lead_id)) : null,
			prompt: row.objective ?? "Imported research request",
			status: String(row.status ?? "QUEUED").toUpperCase(),
			createdAt: row.created_at ?? null,
			updatedAt: row.updated_at ?? row.created_at ?? null,
		};
	}
	if (table === "research_findings") {
		return {
			requestId: row.request_id ? targetIdFor("research_requests", String(row.request_id)) : null,
			field: row.field_name ?? null,
			summary: row.evidence_summary ?? String(row.proposed_value ?? ""),
			value: row.proposed_value ?? null,
			confidence: row.confidence ?? 0,
			status: String(row.approval_state ?? "PROPOSED").toUpperCase(),
		};
	}
	if (table === "manual_communication_drafts" || table === "saved_email_drafts") {
		return {
			ownerUserId: ownerId,
			mailboxId: row.mailbox_id
				? targetIdFor("mailbox_connections", String(row.mailbox_id))
				: null,
			recipientRouteId: row.route_id ? targetIdFor("contact_routes", String(row.route_id)) : null,
			subject: row.subject ?? null,
			body: row.body ?? row.phone_script ?? "",
			status: String(row.status ?? "DRAFT").toUpperCase(),
			createdAt: row.created_at ?? null,
			updatedAt: row.updated_at ?? row.created_at ?? null,
		};
	}
	if (table === "profiles" || table === "football_entities") return {};
	return {
		ownerUserId: ownerId,
		parentTargetId: parentTargetId(row),
		...timestamps,
	};
};

const mappedCoverage = (row: Record<string, unknown>): FieldCoverage => ({
	mapped: Object.keys(row),
	intentionallyExcluded: {},
	unsupported: {},
});

const excludedCoverage = (
	row: Record<string, unknown>,
	reason: string,
): FieldCoverage => ({
	mapped: [],
	intentionallyExcluded: Object.fromEntries(
		Object.keys(row).map((field) => [field, reason]),
	),
	unsupported: {},
});

const unsupportedCoverage = (row: Record<string, unknown>): FieldCoverage => ({
	mapped: [],
	intentionallyExcluded: {},
	unsupported: Object.fromEntries(
		Object.keys(row).map((field) => [field, "UNSUPPORTED_SOURCE_TABLE"]),
	),
});

const duplicateFingerprint = (
	table: string,
	row: Record<string, unknown>,
	targetTable: string,
) => {
	if (table.startsWith("duplicate_") || table.includes("merge")) return null;
	if (table === "leads")
		return `lead:${normalizeName(row.name)}:${normalizeName(row.organization)}`;
	if (table === "football_entities")
		return `${targetTable}:${normalizeName(row.display_name)}`;
	if (table === "contact_routes" || table === "football_contact_routes")
		return `route:${String(row.route_type ?? "").toLowerCase()}:${normalizeName(row.value ?? row.route_value)}`;
	if (table === "profiles") return `profile:${normalizeName(row.email)}`;
	return null;
};

const mappingReject = (
	identity: ReturnType<typeof sourceIdentity>,
	table: string,
	reasonCode: string,
	row: Record<string, unknown>,
): MigrationOutcome => ({
	...identity,
	sourceTable: table,
	outcome: "REJECTED",
	reasonCode,
	fieldCoverage: unsupportedCoverage(row),
});

export const planRow = (
	{ table, row }: ExportRow,
	context: PlanContext,
): MigrationOutcome => {
	const identity = sourceIdentity(table, row);
	const exclusionReason = PLATFORM_EXCLUSIONS[table];
	if (exclusionReason) {
		return {
			...identity,
			sourceTable: table,
			outcome: "EXCLUDED",
			reasonCode: exclusionReason,
			fieldCoverage: excludedCoverage(row, exclusionReason),
		};
	}
	const definition = mappingFor(table, row);
	if (!definition) return mappingReject(identity, table, "UNSUPPORTED_SOURCE_TABLE", row);
	if (definition.ownerRequired && !resolveOwner(row, context)) {
		return mappingReject(
			identity,
			table,
			context.ownerUserId ? "MISSING_OWNER_MAPPING" : "MISSING_V2_OWNER",
			row,
		);
	}
	if (table === "leads" && !String(row.name ?? "").trim())
		return mappingReject(identity, table, "MISSING_REQUIRED_NAME", row);
	if (table === "templates" && (!String(row.name ?? "").trim() || !String(row.body ?? "").trim()))
		return mappingReject(identity, table, "MISSING_TEMPLATE_CONTENT", row);
	if (table === "proof_items" && !String(row.title ?? "").trim())
		return mappingReject(identity, table, "MISSING_REQUIRED_TITLE", row);
	if (table === "football_entities" && !String(row.display_name ?? "").trim())
		return mappingReject(identity, table, "MISSING_REQUIRED_NAME", row);

	const targetTable = definition.targetTable;
	const fingerprint = duplicateFingerprint(table, row, targetTable);
	if (fingerprint && context.existingFingerprints?.has(fingerprint)) {
		return {
			...identity,
			sourceTable: table,
			outcome: "DUPLICATE_CANDIDATE",
			targetTable,
			reasonCode: "NORMALIZED_IDENTITY_COLLISION",
			fieldCoverage: mappedCoverage(row),
		};
	}
	if (fingerprint) context.existingFingerprints?.add(fingerprint);
	const targetId = persistedTargetId(table, targetTable, row);
	return {
		...identity,
		sourceTable: table,
		outcome: "MAPPED",
		targetTable,
		targetId,
		fieldCoverage: mappedCoverage(row),
		payload: {
			...targetFieldsFor(table, row, context, identity),
			sourceKey: sourceKeyFor(table, identity.sourceIdHash),
			sourceTable: table,
			sourceIdHash: identity.sourceIdHash,
			sourceSnapshot: row,
		},
	};
};

export const planRows = (rows: ExportRow[], context: PlanContext) => {
	const fingerprints = context.existingFingerprints ?? new Set<string>();
	const ownerMap = { ...(context.ownerMap ?? {}) };
	for (const item of rows.filter((candidate) => candidate.table === "profiles")) {
		ownerMap[String(sourceId(item.row))] = targetIdFor("profiles", sourceId(item.row));
	}
	const planningContext = {
		...context,
		existingFingerprints: fingerprints,
		ownerMap,
	};
	return rows.map((row) => planRow(row, planningContext));
};

export const summarize = (outcomes: MigrationOutcome[]) => {
	const byOutcome = {
		MAPPED: 0,
		REJECTED: 0,
		DUPLICATE_CANDIDATE: 0,
		EXCLUDED: 0,
	};
	const byReason: Record<string, number> = {};
	for (const outcome of outcomes) {
		byOutcome[outcome.outcome] += 1;
		if (outcome.reasonCode)
			byReason[outcome.reasonCode] = (byReason[outcome.reasonCode] ?? 0) + 1;
	}
	const platformInternalRows = outcomes.filter(
		(outcome) =>
			outcome.outcome === "EXCLUDED" &&
			["PLATFORM_SCHEMA_STATE", "DERIVED_TELEMETRY", "DERIVED_METRICS"].includes(
				outcome.reasonCode ?? "",
			),
	).length;
	const controlOnlyRows = outcomes.filter(
		(outcome) =>
			outcome.outcome === "EXCLUDED" &&
			(outcome.reasonCode?.includes("CONTROL_ONLY") ||
				outcome.reasonCode === "SECRET_NOT_MIGRATED" ||
				outcome.reasonCode?.startsWith("REBUILDABLE_")),
	).length;
	const intentionallyExcludedBusinessRows = outcomes.filter(
		(outcome) =>
			outcome.outcome === "EXCLUDED" &&
			!outcome.reasonCode?.includes("CONTROL_ONLY") &&
			!outcome.reasonCode?.includes("SECRET_NOT_MIGRATED") &&
			!outcome.reasonCode?.startsWith("PLATFORM_") &&
			!outcome.reasonCode?.startsWith("DERIVED_") &&
			!outcome.reasonCode?.startsWith("REBUILDABLE_"),
	).length;
	const fieldCoverageComplete = outcomes.every((outcome) => {
		const coverage = outcome.fieldCoverage;
		if (!coverage) return false;
		return Object.keys(coverage.unsupported).length === 0;
	});
	const unresolvedBusinessRows =
		byOutcome.REJECTED +
		byOutcome.DUPLICATE_CANDIDATE +
		intentionallyExcludedBusinessRows;
	return {
		total: outcomes.length,
		byOutcome,
		byReason,
		accounted: outcomes.length,
		platformInternalRows,
		controlOnlyRows,
		intentionallyExcludedBusinessRows,
		unresolvedBusinessRows,
		fieldCoverageComplete,
		complete: unresolvedBusinessRows === 0 && fieldCoverageComplete,
	};
};

export const newRunId = () => `v1_${randomUUID()}`;
