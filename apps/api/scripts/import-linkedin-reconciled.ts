import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { db } from "@crm/db";

const IMPORT_KEY = "linkedin-reconciled-final";
const IHSAN_EMAIL = "ihsan@iblmedia.com";
const SOURCE_PATH_ENV = "LINKEDIN_RECONCILED_PATH";
const REPORT_PATH_ENV = "LINKEDIN_IMPORT_REPORT_PATH";

type SourceMessage = {
	timestamp: string | null;
	workflow_timestamp: string | null;
	text: string;
	transmission_status?: string | null;
	source_turn_id?: string | null;
	source?: string | null;
};

type SourceRecord = {
	index: number;
	person_name: string;
	linkedin_profile: string | null;
	company_or_agency: string | null;
	messages_sent: SourceMessage[];
	messages_found_in_workflow: SourceMessage[];
	replies_received: SourceMessage[];
	current_outcome_status: string | null;
	off_linkedin: string | null;
	opportunity_status: string;
	audit_completeness: string | null;
	evidence_sources: string[];
	thread_status: string | null;
};

type SourceFile = {
	records: unknown[];
	unresolved_historical_mentions?: unknown[];
};

type ImportedEvent = {
	direction: "INBOUND" | "OUTBOUND";
	provenance: "LINKEDIN_VERIFIED" | "WORKFLOW_ONLY";
	text: string;
	rawTimestamp: string | null;
	workflowTimestamp: string | null;
	transmissionStatus: string | null;
	sourceTurnId: string | null;
	sourceKind:
		| "messages_sent"
		| "messages_found_in_workflow"
		| "replies_received";
	sourceIndex: number;
};

type Report = {
	completedAt: string;
	sourcePath: string;
	dryRun: boolean;
	backupRequiredBeforeRun: true;
	contactsCreated: number;
	contactsMatched: number;
	companiesCreated: number;
	companiesMatched: number;
	linkedinRoutesCreated: number;
	linkedinRoutesMatched: number;
	verifiedMessageActivitiesImported: number;
	workflowOnlyMessageActivitiesImported: number;
	replyActivitiesImported: number;
	crossChannelNotesImported: number;
	messageActivitiesImported: number;
	activeLeadsCreated: number;
	parkedRecords: number;
	uncertainReviewRecords: number;
	reviewTasksCreated: number;
	stageHistoryRowsCreated: number;
	duplicatesAvoided: number;
	incompleteRecords: Array<{ person: string; reason: string }>;
	unsafeToImport: Array<{ person: string; reason: string }>;
	activeAtlasMetricsAffected: false;
	linkedInAutomationEnabled: false;
	atlasLiveOutreachEnabled: false;
};

function stringValue(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function messageList(value: unknown): SourceMessage[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!item || typeof item !== "object") return [];
		const row = item as Record<string, unknown>;
		const text = stringValue(row.text);
		if (!text) return [];
		return [
			{
				timestamp: stringValue(row.timestamp),
				workflow_timestamp: stringValue(row.workflow_timestamp),
				text,
				transmission_status: stringValue(row.transmission_status),
				source_turn_id: stringValue(row.source_turn_id),
				source: stringValue(row.source),
			},
		];
	});
}

function sourceRecord(value: unknown, index: number): SourceRecord {
	if (!value || typeof value !== "object")
		throw new Error(`Record ${index} is not an object`);
	const row = value as Record<string, unknown>;
	const person = stringValue(row.person_name);
	if (!person) throw new Error(`Record ${index} has no person_name`);
	return {
		index,
		person_name: person,
		linkedin_profile: stringValue(row.linkedin_profile),
		company_or_agency: stringValue(row.company_or_agency),
		messages_sent: messageList(row.messages_sent),
		messages_found_in_workflow: messageList(row.messages_found_in_workflow),
		replies_received: messageList(row.replies_received),
		current_outcome_status: stringValue(row.current_outcome_status),
		off_linkedin: stringValue(row.off_linkedin),
		opportunity_status: stringValue(row.opportunity_status) ?? "uncertain",
		audit_completeness: stringValue(row.audit_completeness),
		evidence_sources: Array.isArray(row.evidence_sources)
			? row.evidence_sources.flatMap((item) =>
					typeof item === "string" ? [item] : [],
				)
			: [],
		thread_status: stringValue(row.thread_status),
	};
}

function normalizeText(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeLinkedIn(value: string): string {
	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase().replace(/^www\./, "");
		const path = url.pathname.replace(/\/+$/, "").toLowerCase();
		return `${host}${path}`;
	} catch {
		return normalizeText(value)
			.replace(/^https?:\/\//, "")
			.replace(/^www\./, "")
			.replace(/\/+$/, "");
	}
}

function normalizeRoute(value: string): string {
	return normalizeLinkedIn(value);
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function identityKey(record: SourceRecord): string {
	return record.linkedin_profile
		? `linkedin:${normalizeLinkedIn(record.linkedin_profile)}`
		: `name:${normalizeText(record.person_name)}|company:${normalizeText(record.company_or_agency ?? "")}`;
}

function contactIdFor(record: SourceRecord): string {
	return `linkedin-contact-${hash(identityKey(record))}`;
}

function companyIdFor(name: string): string {
	return `linkedin-company-${hash(normalizeText(name))}`;
}

function activityIdFor(
	contactId: string,
	event: ImportedEvent,
	index: number,
): string {
	return `linkedin-activity-${hash(`${contactId}|${event.sourceKind}|${event.sourceIndex}|${event.provenance}|${event.rawTimestamp ?? ""}|${event.workflowTimestamp ?? ""}|${event.text}|${index}`)}`;
}

function stageHistoryIdFor(leadId: string): string {
	return `linkedin-stage-history-${hash(leadId)}`;
}

function leadIdFor(record: SourceRecord): string {
	return `linkedin-lead-${hash(identityKey(record))}`;
}

function reviewTaskKeyFor(record: SourceRecord): string {
	return `linkedin-review:${hash(identityKey(record))}`;
}

function splitName(name: string): {
	firstName: string;
	lastName: string | null;
} {
	const parts = name.trim().split(/\s+/);
	return {
		firstName: parts[0] ?? name.trim(),
		lastName: parts.slice(1).join(" ") || null,
	};
}

function parseDate(value: string | null): Date | null {
	if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
	const parsed = new Date(
		value.includes("T") ? value : value.replace(" ", "T"),
	);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clockMinutes(value: string | null): number | null {
	if (!value) return null;
	const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (!match) return null;
	return Number(match[1]) * 60 + Number(match[2]);
}

function eventDate(event: ImportedEvent): Date | null {
	return parseDate(event.rawTimestamp) ?? parseDate(event.workflowTimestamp);
}

function eventSortKey(event: ImportedEvent): number {
	const date = eventDate(event);
	if (date) return date.getTime();
	const clock = clockMinutes(event.rawTimestamp);
	return clock === null
		? Number.MAX_SAFE_INTEGER
		: 8_000_000_000_000 + clock * 60_000;
}

function eventsFor(record: SourceRecord): ImportedEvent[] {
	const events: ImportedEvent[] = [];
	for (const [sourceKind, messages, direction, provenance] of [
		["messages_sent", record.messages_sent, "OUTBOUND", "LINKEDIN_VERIFIED"],
		[
			"messages_found_in_workflow",
			record.messages_found_in_workflow,
			"OUTBOUND",
			"WORKFLOW_ONLY",
		],
		["replies_received", record.replies_received, "INBOUND", "WORKFLOW_ONLY"],
	] as const) {
		messages.forEach((message, sourceIndex) => {
			const replyVerified =
				sourceKind === "replies_received" &&
				Boolean(message.timestamp) &&
				!message.source;
			events.push({
				direction,
				provenance:
					sourceKind === "replies_received" && replyVerified
						? "LINKEDIN_VERIFIED"
						: provenance,
				text: message.text,
				rawTimestamp: message.timestamp,
				workflowTimestamp: message.workflow_timestamp,
				transmissionStatus: message.transmission_status ?? message.source,
				sourceTurnId: message.source_turn_id,
				sourceKind,
				sourceIndex,
			});
		});
	}
	return events.sort((left, right) => eventSortKey(left) - eventSortKey(right));
}

function classification(
	record: SourceRecord,
): "active" | "parked" | "uncertain" {
	if (
		record.opportunity_status === "active" ||
		record.opportunity_status === "active_or_warm"
	)
		return "active";
	if (record.opportunity_status === "parked_or_stale") return "parked";
	return "uncertain";
}

function conversationStatus(record: SourceRecord): "NEEDS_IHSAN" | "PARKED" {
	return classification(record) === "parked" ? "PARKED" : "NEEDS_IHSAN";
}

function conversationClassification(
	record: SourceRecord,
	events: ImportedEvent[],
):
	| "WARM_HANDOFF"
	| "WAITING_ON_PROSPECT"
	| "PARKED_NO_CURRENT_NEED"
	| "AMBIGUOUS_OR_NEEDS_IHSAN" {
	if (classification(record) === "parked") return "PARKED_NO_CURRENT_NEED";
	if (record.off_linkedin) return "WARM_HANDOFF";
	if (events.some((event) => event.direction === "INBOUND"))
		return "WARM_HANDOFF";
	if (classification(record) === "active") return "WAITING_ON_PROSPECT";
	return "AMBIGUOUS_OR_NEEDS_IHSAN";
}

function eventSourceKey(
	record: SourceRecord,
	event: ImportedEvent,
	index: number,
): string {
	return `${IMPORT_KEY}:message:${hash(`${identityKey(record)}|${event.sourceKind}|${event.sourceIndex}|${event.provenance}|${event.rawTimestamp ?? ""}|${event.workflowTimestamp ?? ""}|${event.text}|${index}`)}`;
}

function leadStage(
	record: SourceRecord,
	events: ImportedEvent[],
): "CONTACTED" | "REPLIED" | "WARM" {
	if (record.opportunity_status === "active_or_warm") return "WARM";
	if (events.some((event) => event.direction === "INBOUND")) return "REPLIED";
	return "CONTACTED";
}

function descriptionForReview(record: SourceRecord): string {
	return [
		"Imported from the reconciled LinkedIn outreach dataset.",
		"No sales stage was inferred because the source classification is uncertain.",
		record.current_outcome_status
			? `Current source outcome: ${record.current_outcome_status}`
			: null,
		record.thread_status ? `Thread status: ${record.thread_status}` : null,
		record.audit_completeness
			? `Audit completeness: ${record.audit_completeness}`
			: null,
		record.evidence_sources.length
			? `Evidence: ${record.evidence_sources.join(", ")}`
			: null,
	]
		.filter(Boolean)
		.join("\n");
}

async function loadSource(
	path: string,
): Promise<{ records: SourceRecord[]; unresolved: unknown[] }> {
	const parsed = JSON.parse(await readFile(path, "utf8")) as SourceFile;
	if (!Array.isArray(parsed.records))
		throw new Error("The reconciled file has no records array");
	return {
		records: parsed.records.map(sourceRecord),
		unresolved: Array.isArray(parsed.unresolved_historical_mentions)
			? parsed.unresolved_historical_mentions
			: [],
	};
}

async function currentUser() {
	const user = await db.user.findUnique({
		where: { email: IHSAN_EMAIL },
		select: { id: true, kind: true, profile: { select: { status: true } } },
	});
	if (user?.kind !== "HUMAN" || user.profile?.status !== "ACTIVE")
		throw new Error(
			"An active human Ihsan account is required for historical import ownership",
		);
	return user;
}

async function counts() {
	const [contacts, companies, routes, activities, leads, tasks] =
		await Promise.all([
			db.contact.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
			db.company.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
			db.contactRoute.groupBy({
				by: ["lifecycleState"],
				_count: { _all: true },
			}),
			db.activity.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
			db.lead.groupBy({ by: ["stage"], _count: { _all: true } }),
			db.operationalTask.groupBy({ by: ["status"], _count: { _all: true } }),
		]);
	return { contacts, companies, routes, activities, leads, tasks };
}

async function main() {
	if (process.env.ATLAS_LIVE_OUTREACH_ENABLED !== "false")
		throw new Error("ATLAS_LIVE_OUTREACH_ENABLED must be explicitly false");
	const sourcePath = process.env[SOURCE_PATH_ENV]?.trim();
	if (!sourcePath) throw new Error(`${SOURCE_PATH_ENV} is required`);
	const dryRun = process.argv.includes("--dry-run");
	const source = await loadSource(sourcePath);
	const user = await currentUser();
	const appSetting = await db.appSetting.findUnique({
		where: { id: "app" },
		select: { atlasLiveOutreachEnabled: true },
	});
	if (appSetting?.atlasLiveOutreachEnabled)
		throw new Error("Database app setting has live outreach enabled");

	const initial = await counts();
	const report: Report = {
		completedAt: new Date().toISOString(),
		sourcePath,
		dryRun,
		backupRequiredBeforeRun: true,
		contactsCreated: 0,
		contactsMatched: 0,
		companiesCreated: 0,
		companiesMatched: 0,
		linkedinRoutesCreated: 0,
		linkedinRoutesMatched: 0,
		verifiedMessageActivitiesImported: 0,
		workflowOnlyMessageActivitiesImported: 0,
		replyActivitiesImported: 0,
		crossChannelNotesImported: 0,
		messageActivitiesImported: 0,
		activeLeadsCreated: 0,
		parkedRecords: 0,
		uncertainReviewRecords: 0,
		reviewTasksCreated: 0,
		stageHistoryRowsCreated: 0,
		duplicatesAvoided: 0,
		incompleteRecords: [],
		unsafeToImport: source.unresolved.map((value) => ({
			person: "unresolved historical mention",
			reason: JSON.stringify(value),
		})),
		activeAtlasMetricsAffected: false,
		linkedInAutomationEnabled: false,
		atlasLiveOutreachEnabled: false,
	};

	if (dryRun) {
		for (const record of source.records) {
			const kind = classification(record);
			const events = eventsFor(record);
			if (kind === "active") report.activeLeadsCreated += 1;
			if (kind === "parked") report.parkedRecords += 1;
			if (kind === "uncertain") report.uncertainReviewRecords += 1;
			report.verifiedMessageActivitiesImported += events.filter(
				(event) => event.provenance === "LINKEDIN_VERIFIED",
			).length;
			report.workflowOnlyMessageActivitiesImported += events.filter(
				(event) => event.provenance === "WORKFLOW_ONLY",
			).length;
			report.replyActivitiesImported += events.filter(
				(event) => event.direction === "INBOUND",
			).length;
			report.messageActivitiesImported += events.length;
			if (record.off_linkedin) report.crossChannelNotesImported += 1;
		}
		report.reviewTasksCreated = report.uncertainReviewRecords;
		console.log(
			JSON.stringify(
				{
					report,
					initial,
					sourceRecords: source.records.length,
					ownerUserId: user.id,
				},
				null,
				2,
			),
		);
		return;
	}

	await db.$transaction(async (tx) => {
		await tx.$executeRawUnsafe(
			"SELECT pg_advisory_xact_lock(hashtext('linkedin-reconciled-final-import'))",
		);
		const activeCompanies = await tx.company.findMany({
			where: { lifecycleState: "ACTIVE" },
			select: { id: true, name: true },
		});
		const activeContacts = await tx.contact.findMany({
			where: { lifecycleState: "ACTIVE" },
			select: {
				id: true,
				firstName: true,
				lastName: true,
				linkedinUrl: true,
				companyId: true,
			},
		});
		const activeRoutes = await tx.contactRoute.findMany({
			where: { lifecycleState: "ACTIVE" },
			select: { id: true, type: true, normalizedValue: true, contactId: true },
		});
		const companyMap = new Map(
			activeCompanies.map((company) => [normalizeText(company.name), company]),
		);
		const contactMap = new Map(
			activeContacts.map((contact) => [
				normalizeText(`${contact.firstName} ${contact.lastName ?? ""}`),
				contact,
			]),
		);
		const contactProfileMap = new Map(
			activeContacts.flatMap((contact) =>
				contact.linkedinUrl
					? [[normalizeLinkedIn(contact.linkedinUrl), contact] as const]
					: [],
			),
		);
		const routeContactProfileMap = new Map(
			activeRoutes.flatMap((route) =>
				route.type === "LINKEDIN"
					? [[route.normalizedValue, route.contactId] as const]
					: [],
			),
		);
		const routeMap = new Map(
			activeRoutes.map((route) => [
				`${route.type}:${route.normalizedValue}`,
				route,
			]),
		);
		const latestContactDates = new Map<string, Date>();
		const latestCompanyDates = new Map<string, Date>();

		for (const record of source.records) {
			const nameMatch = contactMap.get(normalizeText(record.person_name));
			if (!record.linkedin_profile && nameMatch) {
				report.unsafeToImport.push({
					person: record.person_name,
					reason:
						"No LinkedIn identity key was supplied and a same-name CRM contact exists; held for manual identity review.",
				});
				report.incompleteRecords.push({
					person: record.person_name,
					reason: "Ambiguous identity match held for review",
				});
				continue;
			}
			let company = null;
			if (record.company_or_agency) {
				const companyName = normalizeText(record.company_or_agency);
				company = companyMap.get(companyName) ?? null;
				if (company) {
					report.companiesMatched += 1;
					report.duplicatesAvoided += 1;
				} else {
					company = await tx.company.create({
						data: {
							id: companyIdFor(record.company_or_agency),
							name: record.company_or_agency,
							ownerId: user.id,
							source: "IMPORT",
							description:
								"Imported from the reconciled LinkedIn outreach dataset; company attribution was supplied by the source.",
						},
						select: { id: true, name: true },
					});
					report.companiesCreated += 1;
					companyMap.set(companyName, company);
				}
			}

			const { firstName, lastName } = splitName(record.person_name);
			const contactId = contactIdFor(record);
			let contact = await tx.contact.findUnique({
				where: { id: contactId },
				select: {
					id: true,
					firstName: true,
					lastName: true,
					linkedinUrl: true,
					companyId: true,
				},
			});
			if (!contact) {
				const normalizedProfile = record.linkedin_profile
					? normalizeLinkedIn(record.linkedin_profile)
					: null;
				const profileMatch = normalizedProfile
					? (contactProfileMap.get(normalizedProfile) ??
						(routeContactProfileMap.has(normalizedProfile)
							? (activeContacts.find(
									(contact) =>
										contact.id ===
										routeContactProfileMap.get(normalizedProfile),
								) ?? null)
							: null))
					: null;
				if (profileMatch) {
					contact = profileMatch;
					report.contactsMatched += 1;
					report.duplicatesAvoided += 1;
				} else {
					contact = await tx.contact.create({
						data: {
							id: contactId,
							firstName,
							lastName,
							linkedinUrl: record.linkedin_profile,
							companyId: company?.id ?? null,
							ownerId: user.id,
							source: "IMPORT",
						},
						select: {
							id: true,
							firstName: true,
							lastName: true,
							linkedinUrl: true,
							companyId: true,
						},
					});
					report.contactsCreated += 1;
					contactMap.set(
						normalizeText(`${firstName} ${lastName ?? ""}`),
						contact,
					);
				}
			}
			if (company && !contact.companyId)
				contact = await tx.contact.update({
					where: { id: contact.id },
					data: { companyId: company.id },
					select: {
						id: true,
						firstName: true,
						lastName: true,
						linkedinUrl: true,
						companyId: true,
					},
				});
			if (record.linkedin_profile) {
				const normalized = normalizeRoute(record.linkedin_profile);
				const routeKey = `LINKEDIN:${normalized}`;
				const existingRoute =
					routeMap.get(routeKey) ??
					(await tx.contactRoute.findFirst({
						where: {
							type: "LINKEDIN",
							normalizedValue: normalized,
							lifecycleState: "ACTIVE",
						},
						select: {
							id: true,
							type: true,
							normalizedValue: true,
							contactId: true,
						},
					}));
				if (existingRoute) {
					report.linkedinRoutesMatched += 1;
					report.duplicatesAvoided += 1;
					if (existingRoute.contactId && existingRoute.contactId !== contact.id)
						report.incompleteRecords.push({
							person: record.person_name,
							reason:
								"LinkedIn route already belongs to another active contact",
						});
				} else {
					const route = await tx.contactRoute.create({
						data: {
							id: `linkedin-route-${hash(normalized)}`,
							contactId: contact.id,
							ownerUserId: user.id,
							type: "LINKEDIN",
							value: record.linkedin_profile,
							normalizedValue: normalized,
							visibility: "PRIVATE",
							sourceKey: `${IMPORT_KEY}:route:${hash(normalized)}`,
						},
						select: {
							id: true,
							type: true,
							normalizedValue: true,
							contactId: true,
						},
					});
					routeMap.set(routeKey, route);
					report.linkedinRoutesCreated += 1;
				}
			}

			const kind = classification(record);
			const events = eventsFor(record);
			const leadStageValue =
				kind === "active" ? leadStage(record, events) : "NEW";
			let leadId: string | null = null;
			if (kind !== "uncertain") {
				leadId = leadIdFor(record);
				const existingLead = await tx.lead.findUnique({
					where: {
						sourceKey: `${IMPORT_KEY}:lead:${hash(identityKey(record))}`,
					},
					select: { id: true },
				});
				if (existingLead) {
					leadId = existingLead.id;
					report.duplicatesAvoided += 1;
				} else {
					await tx.lead.create({
						data: {
							id: leadId,
							name: record.person_name,
							status: kind === "parked" ? "NURTURING" : "NEW",
							stage: leadStageValue,
							priority: "NORMAL",
							contactId: contact.id,
							companyId: company?.id ?? null,
							ownerUserId: user.id,
							createdByUserId: user.id,
							source: "IMPORT",
							sourceKey: `${IMPORT_KEY}:lead:${hash(identityKey(record))}`,
							originChannel: "LINKEDIN",
							nextActionAt: kind === "active" ? new Date() : null,
							nextActionTitle:
								kind === "active"
									? "Review the imported LinkedIn conversation before any next contact"
									: null,
							outcomeNote: record.current_outcome_status,
							attentionState: kind === "parked" ? "PARKED" : "NONE",
							lastContactedAt: latestDate(
								events.filter((event) => event.direction === "OUTBOUND"),
							),
							lastRepliedAt: latestDate(
								events.filter((event) => event.direction === "INBOUND"),
							),
							needsReview: false,
						},
					});
					if (kind === "active") report.activeLeadsCreated += 1;
					if (kind === "parked") report.parkedRecords += 1;
					const historyId = stageHistoryIdFor(leadId);
					await tx.leadStageHistory.upsert({
						where: { id: historyId },
						create: {
							id: historyId,
							leadId,
							fromStage: null,
							toStage: leadStageValue,
							reason: `Imported from reconciled LinkedIn data; source classification ${record.opportunity_status}. No prior CRM stage history was available.`,
							actorUserId: user.id,
						},
						update: {},
					});
					report.stageHistoryRowsCreated += 1;
				}
			}
			if (kind === "uncertain") {
				report.uncertainReviewRecords += 1;
				const task = await tx.operationalTask.findUnique({
					where: { idempotencyKey: reviewTaskKeyFor(record) },
					select: { id: true },
				});
				if (task) report.duplicatesAvoided += 1;
				else {
					await tx.operationalTask.create({
						data: {
							title: `Review imported LinkedIn history: ${record.person_name}`,
							description: descriptionForReview(record),
							status: "TODO",
							priority: "NORMAL",
							assigneeUserId: user.id,
							createdByUserId: user.id,
							companyId: company?.id ?? null,
							contactId: contact.id,
							dueAt: new Date(),
							idempotencyKey: reviewTaskKeyFor(record),
						},
					});
					report.reviewTasksCreated += 1;
				}
			}

			const conversationEvents = eventsFor(record);
			const firstInboundAt = latestDate(
				conversationEvents.filter((event) => event.direction === "INBOUND"),
			);
			const firstOutboundAt = latestDate(
				conversationEvents.filter((event) => event.direction === "OUTBOUND"),
			);
			const lastMessageAt = latestDate(conversationEvents);
			const conversation = await tx.linkedinConversation.upsert({
				where: { identityKey: identityKey(record) },
				create: {
					contactId: contact.id,
					companyId: company?.id ?? null,
					leadId,
					identityKey: identityKey(record),
					profileUrl: record.linkedin_profile,
					normalizedProfileUrl: record.linkedin_profile
						? normalizeLinkedIn(record.linkedin_profile)
						: null,
					externalConversationKey: `${IMPORT_KEY}:conversation:${hash(identityKey(record))}`,
					status: conversationStatus(record),
					classification: conversationClassification(
						record,
						conversationEvents,
					),
					consent: "UNKNOWN",
					connectionState: "UNKNOWN",
					lastInboundAt: firstInboundAt,
					lastOutboundAt: firstOutboundAt,
					lastMessageAt,
					nextActionAt: classification(record) === "active" ? new Date() : null,
					nextActionTitle:
						classification(record) === "active"
							? "Review imported LinkedIn history before any next contact"
							: null,
				},
				update: {
					leadId: leadId ?? undefined,
					companyId: company?.id ?? undefined,
					profileUrl: record.linkedin_profile ?? undefined,
					normalizedProfileUrl: record.linkedin_profile
						? normalizeLinkedIn(record.linkedin_profile)
						: undefined,
				},
				select: { id: true },
			});
			await tx.channelEngagementState.upsert({
				where: {
					contactId_channel: { contactId: contact.id, channel: "LINKEDIN" },
				},
				create: {
					contactId: contact.id,
					channel: "LINKEDIN",
					status: conversationStatus(record),
					lastInboundAt: firstInboundAt,
					lastOutboundAt: firstOutboundAt,
					reason:
						"Historical LinkedIn import; excluded from active Atlas metrics",
				},
				update: {
					lastInboundAt: firstInboundAt ?? undefined,
					lastOutboundAt: firstOutboundAt ?? undefined,
					reason:
						"Historical LinkedIn import; excluded from active Atlas metrics",
				},
			});

			for (const [eventIndex, event] of events.entries()) {
				const activityId = activityIdFor(contact.id, event, eventIndex);
				const occurredAt = eventDate(event);
				const sourceKey = eventSourceKey(record, event, eventIndex);
				const existingMessage = await tx.linkedinMessage.findUnique({
					where: { sourceKey },
					select: { id: true },
				});
				const message = await tx.linkedinMessage.upsert({
					where: { sourceKey },
					create: {
						conversationId: conversation.id,
						direction: event.direction,
						status: "HISTORICAL",
						provenance: "HISTORICAL_IMPORT",
						body: event.text,
						occurredAt,
						externalMessageKey: sourceKey,
						sourceKey,
						idempotencyKey: sourceKey,
						sourceTurnId: event.sourceTurnId,
						countsTowardAtlasMetrics: false,
						attributedToAtlas: false,
					},
					update: {},
					select: { id: true },
				});
				const existingActivity = await tx.activity.findUnique({
					where: { id: activityId },
					select: { id: true },
				});
				await tx.activity.upsert({
					where: { id: activityId },
					create: {
						id: activityId,
						type: "NOTE",
						subject: `LinkedIn ${event.direction === "OUTBOUND" ? "outbound" : "inbound"} message · ${event.provenance === "LINKEDIN_VERIFIED" ? "verified" : "workflow evidence"}`,
						body: event.text,
						occurredAt,
						contactId: contact.id,
						companyId: company?.id ?? null,
						leadId,
						createdById: user.id,
						linkedinMessageId: message.id,
						meta: {
							importKey: IMPORT_KEY,
							channel: "LINKEDIN",
							direction: event.direction,
							provenance: event.provenance,
							transmissionStatus: event.transmissionStatus,
							sourceTimestamp: event.rawTimestamp,
							workflowTimestamp: event.workflowTimestamp,
							sourceTurnId: event.sourceTurnId,
							sourceKind: event.sourceKind,
							sourceIndex: event.sourceIndex,
							threadStatus: record.thread_status,
							threadCompleteness: record.audit_completeness,
							evidenceSources: record.evidence_sources,
							historical: true,
							countsTowardAtlasMetrics: false,
							attributedToAtlas: false,
						},
					},
					update: { linkedinMessageId: message.id },
				});
				if (existingActivity || existingMessage) report.duplicatesAvoided += 1;
				else {
					report.messageActivitiesImported += 1;
					if (event.provenance === "LINKEDIN_VERIFIED")
						report.verifiedMessageActivitiesImported += 1;
					else report.workflowOnlyMessageActivitiesImported += 1;
					if (event.direction === "INBOUND")
						report.replyActivitiesImported += 1;
				}
				if (occurredAt) {
					const current = latestContactDates.get(contact.id);
					if (!current || occurredAt > current)
						latestContactDates.set(contact.id, occurredAt);
					if (company) {
						const companyCurrent = latestCompanyDates.get(company.id);
						if (!companyCurrent || occurredAt > companyCurrent)
							latestCompanyDates.set(company.id, occurredAt);
					}
				}
			}
			if (record.off_linkedin) {
				const transitionEvent: ImportedEvent = {
					direction: "INBOUND",
					provenance: "WORKFLOW_ONLY",
					text: record.off_linkedin,
					rawTimestamp: null,
					workflowTimestamp: null,
					transmissionStatus:
						"Cross-channel transition evidence; completion not independently confirmed",
					sourceTurnId: null,
					sourceKind: "replies_received",
					sourceIndex: 0,
				};
				const activityId = `linkedin-cross-channel-${hash(`${contact.id}|${record.off_linkedin}`)}`;
				const exists = await tx.activity.findUnique({
					where: { id: activityId },
					select: { id: true },
				});
				if (!exists) {
					await tx.activity.create({
						data: {
							id: activityId,
							type: "NOTE",
							subject: "Cross-channel transition evidence",
							body: record.off_linkedin,
							contactId: contact.id,
							companyId: company?.id ?? null,
							leadId,
							createdById: user.id,
							meta: {
								importKey: IMPORT_KEY,
								channel: "CROSS_CHANNEL",
								provenance: transitionEvent.provenance,
								historical: true,
								countsTowardAtlasMetrics: false,
								attributedToAtlas: false,
								evidenceSources: record.evidence_sources,
							},
						},
					});
					report.crossChannelNotesImported += 1;
				} else report.duplicatesAvoided += 1;
			}
		}
		for (const [contactId, lastActivityAt] of latestContactDates)
			await tx.contact.update({
				where: { id: contactId },
				data: { lastActivityAt },
			});
		for (const [companyId, lastActivityAt] of latestCompanyDates)
			await tx.company.update({
				where: { id: companyId },
				data: { lastActivityAt },
			});
	});

	const final = await counts();
	report.completedAt = new Date().toISOString();
	const output = {
		report,
		initial,
		final,
		ownerUserId: user.id,
		sourceRecords: source.records.length,
	};
	if (process.env[REPORT_PATH_ENV])
		await writeFile(
			process.env[REPORT_PATH_ENV],
			JSON.stringify(output, null, 2),
			"utf8",
		);
	console.log(JSON.stringify(output, null, 2));
}

function latestDate(events: ImportedEvent[]): Date | null {
	return (
		events
			.map(eventDate)
			.filter((date): date is Date => date !== null)
			.sort((left, right) => right.getTime() - left.getTime())[0] ?? null
	);
}

await main().finally(() => db.$disconnect());
