import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db, Prisma } from "../packages/db/src/index";

type Cell = string | number | boolean | null;
type SourceRow = { rowId: number; values: Record<string, Cell> };
type WorkbookExport = {
	filename: string;
	sourcePath: string;
	sourceHash: string;
	sheets: Record<string, SourceRow[]>;
};
type Entity = {
	key: string;
	entityType: "PERSON" | "COMPANY" | "PLAYER";
	displayName: string;
	normalizedName: string;
	agencyName: string | null;
	emails: string[];
	linkedInUrls: string[];
	sourceRows: SourceRowRef[];
};
type SourceRowRef = { sheet: string; rowId: number; entityId: string | null };
type Route = {
	type: "EMAIL" | "PHONE" | "LINKEDIN" | "INSTAGRAM" | "OTHER";
	value: string;
	normalizedValue: string;
	entityKeys: Set<string>;
};

const inputPath = process.argv[2];
if (!inputPath)
	throw new Error(
		"Usage: bun scripts/import_prospect_backlog.ts <staging-json>",
	);

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const urlPattern = /https?:\/\/[^\s,;]+/gi;
const ambiguousNames = new Set([
	"dirk hebel",
	"frederic guerra",
	"thomas freismuth",
]);

function text(value: Cell): string {
	return value === null || value === undefined ? "" : String(value).trim();
}

function normalizeName(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function normalizeEmail(value: string): string {
	return value.trim().toLowerCase();
}

function normalizeUrl(value: string): string {
	try {
		const url = new URL(
			/^https?:\/\//i.test(value) ? value : `https://${value}`,
		);
		return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
	} catch {
		return value.trim().toLowerCase().replace(/\s+/g, "");
	}
}

function emails(value: string): string[] {
	return [...value.matchAll(emailPattern)].map((match) =>
		normalizeEmail(match[0]),
	);
}

function urls(value: string, host: string): string[] {
	return [...value.matchAll(urlPattern)]
		.map((match) => match[0].replace(/[.)]+$/, ""))
		.filter((url) => url.toLowerCase().includes(host))
		.map(normalizeUrl);
}

function routeType(value: string): Route["type"] {
	const normalized = value.toLowerCase();
	if (normalized.includes("email")) return "EMAIL";
	if (normalized.includes("phone")) return "PHONE";
	if (normalized.includes("whatsapp")) return "OTHER";
	if (normalized.includes("linkedin")) return "LINKEDIN";
	if (normalized.includes("instagram")) return "INSTAGRAM";
	return "OTHER";
}

function addRoute(
	routes: Map<string, Route>,
	type: Route["type"],
	value: string,
	entityKey: string,
): void {
	const normalizedValue =
		type === "EMAIL"
			? normalizeEmail(value)
			: type === "LINKEDIN" || type === "INSTAGRAM"
				? normalizeUrl(value)
				: value.toLowerCase().replace(/[\s()-]/g, "");
	if (
		!normalizedValue ||
		(type === "EMAIL" && !emailPattern.test(normalizedValue))
	)
		return;
	const key = `${type}:${normalizedValue}`;
	const existing = routes.get(key) ?? {
		type,
		value: value.trim(),
		normalizedValue,
		entityKeys: new Set<string>(),
	};
	existing.entityKeys.add(entityKey);
	routes.set(key, existing);
	emailPattern.lastIndex = 0;
}

function sourceEntityId(values: Record<string, Cell>): string | null {
	for (const key of Object.keys(values)) {
		if (
			!/(entity id|person id|player id|agency id|organization id)$/i.test(key)
		)
			continue;
		const value = text(values[key]);
		if (value) return value;
	}
	return null;
}

function sourceRecordRef(sheet: string, row: SourceRow): SourceRowRef {
	return { sheet, rowId: row.rowId, entityId: sourceEntityId(row.values) };
}

function ensureEntity(entities: Map<string, Entity>, entity: Entity): void {
	const current = entities.get(entity.key);
	if (!current) {
		entities.set(entity.key, entity);
		return;
	}
	current.emails = [...new Set([...current.emails, ...entity.emails])];
	current.linkedInUrls = [
		...new Set([...current.linkedInUrls, ...entity.linkedInUrls]),
	];
	current.sourceRows.push(...entity.sourceRows);
	if (!current.agencyName && entity.agencyName)
		current.agencyName = entity.agencyName;
}

function chunk<T>(values: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < values.length; index += size)
		chunks.push(values.slice(index, index + size));
	return chunks;
}

async function main() {
	const workbook = JSON.parse(
		await readFile(inputPath, "utf8"),
	) as WorkbookExport;
	const existingBatch = await db.prospectSourceBatch.findUnique({
		where: {
			filename_sourceHash: {
				filename: workbook.filename,
				sourceHash: workbook.sourceHash,
			},
		},
		select: { id: true },
	});
	if (existingBatch)
		throw new Error(`Source batch already exists: ${existingBatch.id}`);

	const entities = new Map<string, Entity>();
	const routes = new Map<string, Route>();
	const sheetRows = Object.entries(workbook.sheets);

	for (const row of workbook.sheets["Agents & Decision Makers"] ?? []) {
		const values = row.values;
		const key = text(values["Person ID"]);
		const name = text(values.Name);
		if (!key || !name) continue;
		const entity: Entity = {
			key,
			entityType: "PERSON",
			displayName: name,
			normalizedName: normalizeName(name),
			agencyName: text(values["Agency Relationship(s)"]) || null,
			emails: emails(text(values["Email(s)"])),
			linkedInUrls: urls(text(values.LinkedIn), "linkedin.com"),
			sourceRows: [sourceRecordRef("Agents & Decision Makers", row)],
		};
		ensureEntity(entities, entity);
		for (const email of entity.emails) addRoute(routes, "EMAIL", email, key);
		for (const url of entity.linkedInUrls)
			addRoute(routes, "LINKEDIN", url, key);
		for (const url of urls(text(values.Instagram), "instagram.com"))
			addRoute(routes, "INSTAGRAM", url, key);
		for (const phone of text(values["Phone(s)"])
			.split(/[;|]/)
			.map((item) => item.trim())
			.filter(Boolean))
			addRoute(routes, "PHONE", phone, key);
	}

	for (const row of workbook.sheets.Footballers ?? []) {
		const values = row.values;
		const key = text(values["Player ID"]);
		const name = text(values.Player);
		if (!key || !name) continue;
		ensureEntity(entities, {
			key,
			entityType: "PLAYER",
			displayName: name,
			normalizedName: normalizeName(name),
			agencyName: null,
			emails: [],
			linkedInUrls: [],
			sourceRows: [sourceRecordRef("Footballers", row)],
		});
	}

	for (const row of workbook.sheets.Organizations ?? []) {
		const values = row.values;
		const key = text(values["Organization ID"]);
		const name = text(values.Organization);
		if (!key || !name) continue;
		const entity: Entity = {
			key,
			entityType: "COMPANY",
			displayName: name,
			normalizedName: normalizeName(name),
			agencyName: null,
			emails: [],
			linkedInUrls: urls(text(values.LinkedIn), "linkedin.com"),
			sourceRows: [sourceRecordRef("Organizations", row)],
		};
		ensureEntity(entities, entity);
		for (const url of entity.linkedInUrls)
			addRoute(routes, "LINKEDIN", url, key);
		for (const url of urls(text(values.Instagram), "instagram.com"))
			addRoute(routes, "INSTAGRAM", url, key);
		const website = text(values.Website);
		if (website && /^https?:\/\//i.test(website))
			addRoute(routes, "OTHER", website, key);
	}

	for (const row of workbook.sheets["Contact Routes"] ?? []) {
		const values = row.values;
		const route = text(values["Public Professional Route"]);
		const type = routeType(text(values["Route Type"]));
		const routeId = text(values["Route ID"]);
		const linkRows = (workbook.sheets["Entity Route Links"] ?? []).filter(
			(link) => text(link.values["Route ID"]) === routeId,
		);
		const entityKeys = linkRows
			.map((link) => text(link.values["Entity ID"]))
			.filter((key) => entities.has(key));
		if (route && entityKeys.length)
			for (const entityKey of entityKeys)
				addRoute(routes, type, route, entityKey);
	}

	for (const row of workbook.sheets["Shared Contact Routes"] ?? []) {
		const values = row.values;
		const route = text(values.Route);
		const type = routeType(text(values["Route Type"]));
		const linked = text(values["Linked Entities"])
			.split(/[,;|]/)
			.map((item) => item.trim())
			.filter((item) => entities.has(item));
		for (const entityKey of linked) addRoute(routes, type, route, entityKey);
	}

	const contacts = await db.contact.findMany({
		select: {
			id: true,
			firstName: true,
			lastName: true,
			email: true,
			linkedinUrl: true,
			contactRoutes: {
				select: { type: true, normalizedValue: true, contactId: true },
			},
		},
	});
	const contactRoutes = await db.contactRoute.findMany({
		where: { lifecycleState: "ACTIVE" },
		select: {
			contactId: true,
			companyId: true,
			type: true,
			normalizedValue: true,
		},
	});
	const emailMatches = new Map<string, string[]>();
	const linkedinMatches = new Map<string, string[]>();
	const nameMatches = new Map<string, string[]>();
	for (const contact of contacts) {
		const name = normalizeName(
			[contact.firstName, contact.lastName].filter(Boolean).join(" "),
		);
		if (name)
			nameMatches.set(name, [...(nameMatches.get(name) ?? []), contact.id]);
		if (contact.email)
			emailMatches.set(normalizeEmail(contact.email), [
				...(emailMatches.get(normalizeEmail(contact.email)) ?? []),
				contact.id,
			]);
		if (contact.linkedinUrl)
			linkedinMatches.set(normalizeUrl(contact.linkedinUrl), [
				...(linkedinMatches.get(normalizeUrl(contact.linkedinUrl)) ?? []),
				contact.id,
			]);
	}
	for (const route of contactRoutes) {
		if (route.type === "EMAIL" && route.contactId)
			emailMatches.set(route.normalizedValue, [
				...(emailMatches.get(route.normalizedValue) ?? []),
				route.contactId,
			]);
		if (route.type === "LINKEDIN" && route.contactId)
			linkedinMatches.set(route.normalizedValue, [
				...(linkedinMatches.get(route.normalizedValue) ?? []),
				route.contactId,
			]);
	}

	const batchId = randomUUID();
	const itemIds = new Map<string, string>();
	const itemData = [...entities.values()].map((entity) => {
		const routeEmails = [...routes.values()]
			.filter(
				(route) => route.type === "EMAIL" && route.entityKeys.has(entity.key),
			)
			.map((route) => route.normalizedValue);
		const routeLinkedIn = [...routes.values()]
			.filter(
				(route) =>
					route.type === "LINKEDIN" && route.entityKeys.has(entity.key),
			)
			.map((route) => route.normalizedValue);
		const exactEmails = [
			...new Set(routeEmails.flatMap((email) => emailMatches.get(email) ?? [])),
		];
		const exactLinkedIn = [
			...new Set(
				routeLinkedIn.flatMap((url) => linkedinMatches.get(url) ?? []),
			),
		];
		const nameCandidates = nameMatches.get(entity.normalizedName) ?? [];
		const exactContactId = exactEmails[0] ?? exactLinkedIn[0] ?? null;
		const matchStatus = exactEmails.length
			? "EXACT_EMAIL"
			: exactLinkedIn.length
				? "EXACT_LINKEDIN"
				: nameCandidates.length
					? "CRM_NAME_REVIEW"
					: "NONE";
		const matchCandidateIds = [
			...new Set(
				exactEmails.length
					? exactEmails
					: exactLinkedIn.length
						? exactLinkedIn
						: nameCandidates,
			),
		];
		const hasRoute =
			routeEmails.length > 0 ||
			routeLinkedIn.length > 0 ||
			[...routes.values()].some((route) => route.entityKeys.has(entity.key));
		const ambiguous =
			matchStatus === "CRM_NAME_REVIEW" &&
			(ambiguousNames.has(entity.normalizedName) || nameCandidates.length > 0);
		const state = ambiguous
			? "WITH_IHSAN"
			: !hasRoute
				? "NEEDS_ENRICHMENT"
				: "NOT_REVIEWED";
		const id = randomUUID();
		itemIds.set(entity.key, id);
		return {
			id,
			batchId,
			canonicalKey: entity.key,
			entityType: entity.entityType,
			displayName: entity.displayName,
			normalizedName: entity.normalizedName,
			normalizedEmail: routeEmails[0] ?? null,
			normalizedLinkedInUrl: routeLinkedIn[0] ?? null,
			agencyName: entity.agencyName,
			state,
			matchStatus,
			matchCandidateIds: matchCandidateIds.length
				? matchCandidateIds
				: Prisma.JsonNull,
			reviewReason: ambiguous
				? "Existing CRM name match is ambiguous; review before any merge or promotion."
				: null,
			crmContactId: exactContactId,
			crmCompanyId: null,
			crmLeadId: null,
			lastProcessedAt: null,
			nextReviewAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	});

	await db.prospectSourceBatch.create({
		data: {
			id: batchId,
			filename: workbook.filename,
			sourceHash: workbook.sourceHash,
			sourceSheetCount: sheetRows.length,
			recordCount: sheetRows.reduce(
				(total, [, rows]) => total + rows.length,
				0,
			),
			provenance: {
				sourcePath: workbook.sourcePath,
				importer: "scripts/import_prospect_backlog.ts",
				importedAt: new Date().toISOString(),
				rawSourcePreserved: true,
			},
		},
	});
	for (const group of chunk(itemData, 500))
		await db.prospectBacklogItem.createMany({ data: group as never[] });

	const sourceData = sheetRows.flatMap(([sheet, rows]) =>
		rows.map((row) => {
			const entityId = sourceEntityId(row.values);
			return {
				id: randomUUID(),
				batchId,
				sourceSheet: sheet,
				originalEntityId: entityId,
				originalRowId: row.rowId,
				rawValues: row.values,
				provenance: {
					sourcePath: workbook.sourcePath,
					sourceSheet: sheet,
					originalRowId: row.rowId,
					sourceHash: workbook.sourceHash,
				},
				backlogItemId: entityId ? (itemIds.get(entityId) ?? null) : null,
				createdAt: new Date(),
			};
		}),
	);
	for (const group of chunk(sourceData, 500))
		await db.prospectSourceRecord.createMany({ data: group as never[] });

	const routeData = [...routes.values()].map((route) => ({
		id: randomUUID(),
		batchId,
		type: route.type,
		value: route.value,
		normalizedValue: route.normalizedValue,
		isShared: route.entityKeys.size > 1,
		contactOnce: true,
		linkedEntityKeys: [...route.entityKeys],
		createdAt: new Date(),
		updatedAt: new Date(),
	}));
	for (const group of chunk(routeData, 500))
		await db.prospectBacklogRoute.createMany({ data: group as never[] });
	const storedRoutes = await db.prospectBacklogRoute.findMany({
		where: { batchId },
		select: { id: true, type: true, normalizedValue: true },
	});
	const routeIds = new Map(
		storedRoutes.map((route) => [
			`${route.type}:${route.normalizedValue}`,
			route.id,
		]),
	);
	const routeLinks = [...routes.values()].flatMap((route) =>
		[...route.entityKeys].map((entityKey) => ({
			id: randomUUID(),
			routeId: routeIds.get(`${route.type}:${route.normalizedValue}`) as string,
			itemId: itemIds.get(entityKey) as string,
			relationship: null,
		})),
	);
	for (const group of chunk(routeLinks, 500))
		await db.prospectBacklogRouteLink.createMany({ data: group as never[] });

	const stateCounts = await db.prospectBacklogItem.groupBy({
		by: ["state"],
		where: { batchId },
		_count: { _all: true },
	});
	const sharedRouteCount = await db.prospectBacklogRoute.count({
		where: { batchId, isShared: true },
	});
	const sourceRecordCount = await db.prospectSourceRecord.count({
		where: { batchId },
	});
	console.log(
		JSON.stringify(
			{
				batchId,
				stagedRecords: sourceRecordCount,
				canonicalProspects: itemData.length,
				routes: routeData.length,
				sharedRoutes: sharedRouteCount,
				stateCounts,
			},
			null,
			2,
		),
	);
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
	});
