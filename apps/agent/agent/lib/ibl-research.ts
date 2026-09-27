import { createHash, randomUUID } from "node:crypto";
import { db, type Prisma } from "@crm/db";
import type { IdentityEnvelope } from "@crm/db/security";
import { withPrincipal } from "@crm/db/security";
import { APP_AUTH, type AppAuth } from "./app-auth";
import { requireIblAgentIdentity } from "./ibl-agent-policy";
import type { PurposeContext } from "./session-purpose";

const LEASE_MS = 30 * 60_000;
const MAX_ATTEMPTS = 4;

export type ResearchInspectionInput = {
	identity: IdentityEnvelope;
	request: {
		id: string;
		prompt: string;
		status: string;
		targetType: string;
		targetEntityId: string;
	};
	findings: Array<{
		id: string;
		field: string | null;
		summary: string;
		value: Prisma.JsonValue | null;
		confidence: Prisma.Decimal | number | string;
		status: string;
		evidenceSource: {
			kind: string;
			locator: string;
			title: string | null;
			capturedAt: Date | null;
		};
	}>;
};

export type ResearchInspectionDto = {
	identity: {
		principal: IdentityEnvelope["principal"];
		profile: {
			preferredLanguage: string;
			locale: string;
			timeZone: string;
			workingPreferences: Prisma.JsonValue;
		};
		mailbox: IdentityEnvelope["mailbox"];
		crmTarget: IdentityEnvelope["crmTarget"];
	};
	request: ResearchInspectionInput["request"];
	findings: Array<{
		id: string;
		field: string | null;
		summary: string;
		value: Prisma.JsonValue | null;
		confidence: number;
		status: string;
		evidenceSource: {
			kind: string;
			locator: string;
			title: string | null;
			capturedAt: string | null;
		};
	}>;
};

export function normalizeResearchInspection(
	input: ResearchInspectionInput,
): ResearchInspectionDto {
	return {
		identity: {
			principal: input.identity.principal,
			profile: {
				preferredLanguage: input.identity.profile.preferredLanguage,
				locale: input.identity.profile.locale,
				timeZone: input.identity.profile.timeZone,
				workingPreferences: normalizeJsonValue(
					input.identity.profile.workingPreferences,
				),
			},
			mailbox: input.identity.mailbox,
			crmTarget: input.identity.crmTarget,
		},
		request: input.request,
		findings: input.findings.map((finding) => {
			const confidence = Number(finding.confidence);
			if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
				throw new Error("Research finding confidence is not JSON-safe.");
			}
			return {
				id: finding.id,
				field: finding.field,
				summary: finding.summary,
				value:
					finding.value === null ? null : normalizeJsonValue(finding.value),
				confidence,
				status: finding.status,
				evidenceSource: {
					kind: finding.evidenceSource.kind,
					locator: finding.evidenceSource.locator,
					title: finding.evidenceSource.title,
					capturedAt: finding.evidenceSource.capturedAt
						? finding.evidenceSource.capturedAt.toISOString()
						: null,
				},
			};
		}),
	};
}

function normalizeJsonValue(value: unknown): Prisma.JsonValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw new Error("Research JSON contains a non-finite number.");
		return value;
	}
	if (Array.isArray(value)) return value.map(normalizeJsonValue);
	if (typeof value === "object") {
		if (
			value instanceof Date ||
			Object.getPrototypeOf(value) !== Object.prototype
		) {
			throw new Error("Research JSON contains a non-plain object.");
		}
		const result: { [key: string]: Prisma.JsonValue } = {};
		for (const [key, child] of Object.entries(value)) {
			if (child === undefined) {
				throw new Error(`Research JSON field ${key} is undefined.`);
			}
			result[key] = normalizeJsonValue(child);
		}
		return result;
	}
	throw new Error("Research JSON contains a non-serializable value.");
}

export type ClaimedResearchRequest = {
	id: string;
	ownerUserId: string;
	mailboxId: string | null;
	targetType: string;
	targetEntityId: string;
	prompt: string;
	attemptCount: number;
};

export async function inspectResearchRequest(ctx: PurposeContext) {
	const identity = await requireIblAgentIdentity(ctx, "read.research");
	return withPrincipal(
		db,
		{
			userId: identity.envelope.principal.userId,
			mailboxId: identity.envelope.mailbox?.mailboxId,
			kind: "user",
		},
		async (tx) => {
			const request = await ownedRequest(tx, identity);
			return normalizeResearchInspection({
				identity: identity.envelope,
				request: {
					id: request.id,
					prompt: request.prompt,
					status: request.status,
					targetType: request.targetType,
					targetEntityId: request.targetEntityId,
				},
				findings: await tx.researchFinding.findMany({
					where: { requestId: request.id },
					select: {
						id: true,
						field: true,
						summary: true,
						value: true,
						confidence: true,
						status: true,
						evidenceSource: {
							select: {
								kind: true,
								locator: true,
								title: true,
								capturedAt: true,
							},
						},
					},
					orderBy: { createdAt: "asc" },
				}),
			});
		},
	);
}

export async function recordEvidence(
	ctx: PurposeContext,
	input: {
		kind: "PUBLIC_URL" | "DOCUMENT" | "MAILBOX_MESSAGE" | "MANUAL" | "IMPORT";
		locator: string;
		title?: string;
		observedContent: string;
		capturedAt?: Date;
	},
) {
	const identity = await requireIblAgentIdentity(ctx, "research.evidence");
	const checksum = createHash("sha256")
		.update(input.observedContent)
		.digest("hex");
	return withPrincipal(db, principal(identity), async (tx) => {
		await ownedRequest(tx, identity);
		const source = await tx.evidenceSource.upsert({
			where: {
				kind_locator_checksum: {
					kind: input.kind,
					locator: input.locator,
					checksum,
				},
			},
			create: {
				kind: input.kind,
				locator: input.locator,
				checksum,
				title: input.title,
				capturedAt: input.capturedAt,
				createdByUserId: identity.envelope.principal.userId,
				mailboxId:
					input.kind === "MAILBOX_MESSAGE"
						? identity.envelope.mailbox?.mailboxId
						: null,
				metadata: { contentStored: false },
			},
			update: {},
			select: { id: true, kind: true, locator: true, checksum: true },
		});
		return source;
	});
}

export async function recordFinding(
	ctx: PurposeContext,
	input: {
		evidenceSourceId: string;
		field?: string;
		summary: string;
		value?: Prisma.InputJsonValue;
		confidence: number;
	},
) {
	const identity = await requireIblAgentIdentity(ctx, "research.finding");
	return withPrincipal(db, principal(identity), async (tx) => {
		const request = await ownedRequest(tx, identity);
		const evidence = await tx.evidenceSource.findFirst({
			where: { id: input.evidenceSourceId },
			select: { id: true },
		});
		if (!evidence)
			throw new Error("Evidence source is outside this research scope.");
		return tx.researchFinding.create({
			data: {
				requestId: request.id,
				evidenceSourceId: evidence.id,
				field: input.field,
				summary: input.summary,
				value: input.value,
				confidence: input.confidence,
			},
			select: { id: true, status: true },
		});
	});
}

export async function createResearchDraft(
	ctx: PurposeContext,
	input: { subject?: string; body: string; idempotencyKey: string },
) {
	const identity = await requireIblAgentIdentity(ctx, "proposal.draft");
	return withPrincipal(db, principal(identity), async (tx) => {
		const request = await ownedRequest(tx, identity);
		const draft = await tx.draft.upsert({
			where: { idempotencyKey: scopedKey(request.id, input.idempotencyKey) },
			create: {
				ownerUserId: identity.envelope.principal.userId,
				mailboxId: identity.envelope.mailbox?.mailboxId,
				subject: input.subject,
				body: input.body,
				status: "DRAFT",
				idempotencyKey: scopedKey(request.id, input.idempotencyKey),
			},
			update: {},
			select: { id: true, status: true },
		});
		await auditArtifact(
			tx,
			request.id,
			"AGENT_DRAFT_CREATED",
			"DRAFT",
			draft.id,
		);
		return draft;
	});
}

export async function createResearchProposal(
	ctx: PurposeContext,
	input: {
		title: string;
		summary?: string;
		content: Prisma.InputJsonValue;
		leadId?: string;
		dealId?: string;
		draftId?: string;
		idempotencyKey: string;
	},
) {
	const identity = await requireIblAgentIdentity(ctx, "proposal.create");
	return withPrincipal(db, principal(identity), async (tx) => {
		const request = await ownedRequest(tx, identity);
		if (Boolean(input.leadId) === Boolean(input.dealId)) {
			throw new Error("A proposal requires exactly one owned lead or deal.");
		}
		if (input.leadId) {
			const lead = await tx.lead.findFirst({
				where: {
					id: input.leadId,
					ownerUserId: identity.envelope.principal.userId,
				},
				select: { id: true },
			});
			if (!lead) throw new Error("Lead is outside this research scope.");
		}
		if (input.dealId) {
			const deal = await tx.deal.findFirst({
				where: {
					id: input.dealId,
					ownerId: identity.envelope.principal.userId,
				},
				select: { id: true },
			});
			if (!deal) throw new Error("Deal is outside this research scope.");
		}
		if (input.draftId) {
			const draft = await tx.draft.findFirst({
				where: {
					id: input.draftId,
					ownerUserId: identity.envelope.principal.userId,
				},
				select: { id: true },
			});
			if (!draft) throw new Error("Draft is outside this research scope.");
		}
		const proposal = await tx.proposal.upsert({
			where: { sourceKey: scopedKey(request.id, input.idempotencyKey) },
			create: {
				title: input.title,
				summary: input.summary,
				content: input.content,
				ownerUserId: identity.envelope.principal.userId,
				leadId: input.leadId,
				dealId: input.dealId,
				draftId: input.draftId,
				status: "DRAFT",
				sourceKey: scopedKey(request.id, input.idempotencyKey),
			},
			update: {},
			select: { id: true, status: true },
		});
		await auditArtifact(
			tx,
			request.id,
			"AGENT_PROPOSAL_CREATED",
			"PROPOSAL",
			proposal.id,
		);
		return proposal;
	});
}

export async function submitResearchForReview(
	ctx: PurposeContext,
	input: { summary: string },
) {
	const identity = await requireIblAgentIdentity(ctx, "proposal.review");
	return withPrincipal(db, principal(identity), async (tx) => {
		const request = await ownedRequest(tx, identity);
		const findingCount = await tx.researchFinding.count({
			where: { requestId: request.id },
		});
		if (findingCount === 0) {
			throw new Error(
				"At least one evidence-backed finding is required for review.",
			);
		}
		await tx.researchRequest.update({
			where: { id: request.id },
			data: {
				status: "NEEDS_REVIEW",
				completedAt: new Date(),
				leaseOwner: null,
				leasedUntil: null,
				failureCode: null,
			},
		});
		await tx.domainAuditEvent.create({
			data: {
				actorUserId: identity.envelope.principal.userId,
				action: "AGENT_RESEARCH_SUBMITTED",
				entityType: "RESEARCH_REQUEST",
				entityId: request.id,
				outcome: "NEEDS_REVIEW",
				requestId: `agent-review:${request.id}`,
				metadata: { summary: input.summary.slice(0, 500), findingCount },
			},
		});
		return {
			requestId: request.id,
			status: "NEEDS_REVIEW" as const,
			findingCount,
		};
	});
}

export async function claimResearchRequests(
	limit = 8,
	leaseOwner = `eve:${randomUUID()}`,
): Promise<ClaimedResearchRequest[]> {
	return withPrincipal(db, { userId: null, kind: "worker" }, async (tx) => {
		const leaseUntil = new Date(Date.now() + LEASE_MS);
		return tx.$queryRaw<ClaimedResearchRequest[]>`
			WITH candidates AS (
				SELECT id FROM "researchRequest"
				WHERE (
					(status = 'QUEUED' AND ("retryAt" IS NULL OR "retryAt" <= now()))
					OR (status = 'RUNNING' AND "leasedUntil" < now())
					OR (status = 'FAILED' AND "retryAt" <= now())
				)
				AND "attemptCount" < ${MAX_ATTEMPTS}
				ORDER BY "createdAt" ASC
				FOR UPDATE SKIP LOCKED
				LIMIT ${limit}
			)
			UPDATE "researchRequest" request
			SET status = 'RUNNING',
				"attemptCount" = request."attemptCount" + 1,
				"leaseOwner" = ${leaseOwner},
				"leasedUntil" = ${leaseUntil},
				"startedAt" = COALESCE(request."startedAt", now()),
				"retryAt" = NULL,
				"failureCode" = NULL,
				"updatedAt" = now()
			FROM candidates
			WHERE request.id = candidates.id
			RETURNING request.id,
				request."ownerUserId",
				request."mailboxId",
				request."targetType"::text AS "targetType",
				request."targetEntityId",
				request.prompt,
				request."attemptCount"
		`;
	});
}

export async function completeLocalResearchRequest(
	request: ClaimedResearchRequest,
): Promise<void> {
	if (
		process.env.NODE_ENV === "production" ||
		process.env.IBL_LOCAL_PROVIDER_DOUBLE !== "enabled"
	) {
		throw new Error("LOCAL_RESEARCH_DOUBLE_DISABLED");
	}
	await withPrincipal(
		db,
		{ userId: request.ownerUserId, mailboxId: request.mailboxId, kind: "user" },
		async (tx) => {
			const locator = `local-acceptance:${request.id}`;
			const evidence = await tx.evidenceSource.upsert({
				where: {
					kind_locator_checksum: {
						kind: "MANUAL",
						locator,
						checksum: stableHash(locator),
					},
				},
				create: {
					kind: "MANUAL",
					locator,
					checksum: stableHash(locator),
					title: "Safe local AI research double",
					createdByUserId: request.ownerUserId,
					metadata: { localProviderDouble: true, contentStored: false },
				},
				update: {},
				select: { id: true },
			});
			const existingFinding = await tx.researchFinding.findFirst({
				where: { requestId: request.id, evidenceSourceId: evidence.id },
				select: { id: true },
			});
			if (!existingFinding) {
				await tx.researchFinding.create({
					data: {
						requestId: request.id,
						evidenceSourceId: evidence.id,
						field: "outreachAngle",
						summary:
							"Local acceptance research suggests a concise, evidence-led introduction and a single clear next step.",
						value: { source: "local-provider-double" },
						confidence: 0.9,
					},
				});
			}
			await tx.draft.upsert({
				where: { idempotencyKey: `agent:${request.id}:local-acceptance-draft` },
				create: {
					ownerUserId: request.ownerUserId,
					mailboxId: request.mailboxId,
					subject: "A focused opportunity for your team",
					body: "Hi,\n\nI researched your current priorities and identified one focused way IBL could help. Would you be open to a short conversation next week?\n\nBest,",
					idempotencyKey: `agent:${request.id}:local-acceptance-draft`,
				},
				update: {},
			});
			await tx.researchRequest.update({
				where: { id: request.id },
				data: {
					status: "NEEDS_REVIEW",
					completedAt: new Date(),
					leaseOwner: null,
					leasedUntil: null,
					failureCode: null,
				},
			});
			await tx.domainAuditEvent.createMany({
				data: {
					actorUserId: request.ownerUserId,
					action: "AGENT_RESEARCH_SUBMITTED",
					entityType: "RESEARCH_REQUEST",
					entityId: request.id,
					outcome: "NEEDS_REVIEW",
					requestId: `local-double:${request.id}`,
					metadata: { localProviderDouble: true },
				},
				skipDuplicates: true,
			});
		},
	);
}

export function researchRequestAuth(request: ClaimedResearchRequest): AppAuth {
	return {
		...APP_AUTH,
		attributes: {
			purpose: "research",
			userId: request.ownerUserId,
			researchRequestId: request.id,
			targetType: request.targetType,
			targetEntityId: request.targetEntityId,
			...(request.mailboxId ? { mailboxId: request.mailboxId } : {}),
		},
	};
}

export async function noteResearchContinuation(
	requestId: string,
	continuationToken: string,
): Promise<void> {
	await workerUpdate(requestId, {
		continuationToken,
		leasedUntil: new Date(Date.now() + LEASE_MS),
	});
}

export async function settleResearchRequest(
	requestId: string,
	status: "NEEDS_REVIEW" | "FAILED",
	failureCode?: string,
): Promise<void> {
	const request = await workerRequest(requestId);
	if (request?.status !== "RUNNING") return;
	const requestedStatus =
		status === "NEEDS_REVIEW" && request._count.findings === 0
			? "FAILED"
			: status;
	const requestedFailureCode =
		status === "NEEDS_REVIEW" && request._count.findings === 0
			? "NO_EVIDENCE_BACKED_FINDINGS"
			: failureCode;
	const exhausted = request.attemptCount >= MAX_ATTEMPTS;
	const finalStatus =
		requestedStatus === "FAILED" && !exhausted ? "QUEUED" : requestedStatus;
	await workerUpdate(requestId, {
		status: finalStatus,
		failureCode: requestedFailureCode?.slice(0, 96),
		retryAt:
			finalStatus === "QUEUED"
				? new Date(
						Date.now() +
							Math.min(60_000 * 2 ** request.attemptCount, 3_600_000),
					)
				: null,
		completedAt: finalStatus === "NEEDS_REVIEW" ? new Date() : null,
		leaseOwner: null,
		leasedUntil: null,
	});
}

async function workerRequest(requestId: string) {
	return withPrincipal(db, { userId: null, kind: "worker" }, (tx) =>
		tx.researchRequest.findUnique({
			where: { id: requestId },
			select: {
				status: true,
				attemptCount: true,
				_count: { select: { findings: true } },
			},
		}),
	);
}

async function workerUpdate(
	requestId: string,
	data: Prisma.ResearchRequestUpdateInput,
): Promise<void> {
	await withPrincipal(db, { userId: null, kind: "worker" }, (tx) =>
		tx.researchRequest.update({ where: { id: requestId }, data }),
	);
}

function principal(
	identity: Awaited<ReturnType<typeof requireIblAgentIdentity>>,
) {
	return {
		userId: identity.envelope.principal.userId,
		mailboxId: identity.envelope.mailbox?.mailboxId,
		kind: "user" as const,
	};
}

async function ownedRequest(
	tx: Prisma.TransactionClient,
	identity: Awaited<ReturnType<typeof requireIblAgentIdentity>>,
) {
	const target = identity.envelope.crmTarget;
	const request = await tx.researchRequest.findFirst({
		where: {
			id: identity.researchRequestId,
			ownerUserId: identity.envelope.principal.userId,
			mailboxId: identity.envelope.mailbox?.mailboxId ?? null,
			targetType: target?.kind as never,
			targetEntityId: target?.id,
		},
		select: {
			id: true,
			prompt: true,
			status: true,
			targetType: true,
			targetEntityId: true,
		},
	});
	if (!request)
		throw new Error("Research request is outside this identity envelope.");
	return request;
}

function scopedKey(requestId: string, value: string): string {
	return `agent:${requestId}:${value}`.slice(0, 191);
}

function stableHash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function auditArtifact(
	tx: Prisma.TransactionClient,
	requestId: string,
	action: string,
	entityType: "DRAFT" | "PROPOSAL",
	entityId: string,
) {
	await tx.domainAuditEvent.createMany({
		data: {
			action,
			entityType,
			entityId,
			outcome: "CREATED_FOR_HUMAN_REVIEW",
			requestId: `${requestId}:${entityId}`,
		},
		skipDuplicates: true,
	});
}
