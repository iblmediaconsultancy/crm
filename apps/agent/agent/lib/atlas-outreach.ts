import type { CommercialQualityInput, CommercialQualityResult } from "@crm/db";
import {
	db,
	evaluateCommercialQuality,
	isPersonProtected,
	isProtectedPlayerContact,
	opportunityCollisionKey,
	Prisma,
	rankCommercialOpportunities,
	validateExternalCopy,
} from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import {
	canRetryCommercialQuality,
	commercialQualityUpdateData,
} from "./atlas-commercial-enrichment";
import { hasUnsupportedOutcomeClaim } from "./atlas-playbook";
import type { PurposeContext } from "./session-purpose";
import { attribute, purposeOf } from "./session-purpose";
import { scheduleTask } from "./tasks";

export const ATLAS_OPERATOR_ID = "atlas-operator";
const POLICY_VERSION = "atlas-v1";
const LANGUAGES = new Set(["english", "dutch", "turkish"]);
const BLOCKED_PRICING_WORDS =
	/\b(?:pricing|prices?|costs?|budgets?|fees?|discounts?|rates?|packages?)\b/i;
const BLOCKED_CURRENCY_AMOUNT =
	/(?:[€$£]\s*\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d{1,2})?\s*[€$£])/i;
const BLOCKED_PERIODIC_AMOUNT =
	/\b\d+(?:[.,]\d+)?\s*(?:per\s+(?:month|mo|week|wk|year|yr)|\/\s*(?:month|mo|week|wk|year|yr))\b/i;

export type AtlasInput = {
	leadId: string;
	routeId: string;
	subject: string;
	body: string;
	language: string;
	idempotencyKey: string;
	commercial?: Partial<CommercialQualityInput>;
};

class CommercialQualityBlockedError extends Error {
	readonly result: CommercialQualityResult;

	constructor(result: CommercialQualityResult) {
		super(
			`COMMERCIAL_QUALITY_${result.status}:${result.reasons
				.map((item) => item.code)
				.join(",")}`,
		);
		this.name = "CommercialQualityBlockedError";
		this.result = result;
	}
}

function assertAtlasSession(ctx: PurposeContext): void {
	if (
		purposeOf(ctx) !== "atlas-outreach" ||
		attribute(ctx, "taskKind") !== "atlas-outreach"
	) {
		throw new Error(
			"This action is available only to the scheduled Atlas operator.",
		);
	}
}

function atlasEnabled(): boolean {
	return (
		process.env.ATLAS_LIVE_OUTREACH_ENABLED?.trim().toLowerCase() === "true"
	);
}

function localParts(
	date: Date,
	timeZone: string,
): { weekday: string; hour: number; minute: number } {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const value = (type: string) =>
		parts.find((part) => part.type === type)?.value ?? "0";
	return {
		weekday: value("weekday"),
		hour: Number(value("hour")),
		minute: Number(value("minute")),
	};
}

export function isWithinAtlasWorkingHours(
	date: Date,
	timeZone: string,
	start: number,
	end: number,
): boolean {
	const current = localParts(date, timeZone);
	if (current.weekday === "Sat" || current.weekday === "Sun") return false;
	const minute = current.hour * 60 + current.minute;
	return minute >= start && minute < end;
}

export function hasBlockedPricingLanguage(value: string): boolean {
	return (
		BLOCKED_PRICING_WORDS.test(value) ||
		BLOCKED_CURRENCY_AMOUNT.test(value) ||
		BLOCKED_PERIODIC_AMOUNT.test(value)
	);
}

export function isAtlasLanguageAllowed(value: string): boolean {
	return LANGUAGES.has(value.trim().toLowerCase());
}

export function isAtlasContactEligible(
	lifecycleState: string,
	outreachState: string,
	attentionState: string,
): boolean {
	return (
		lifecycleState === "ACTIVE" &&
		outreachState === "ALLOWED" &&
		attentionState === "NONE"
	);
}

export function organizationDomain(value: string): string | null {
	const domain = value.trim().toLowerCase().split("@").at(-1);
	return domain || null;
}

export function isOrganizationSuppressed(
	value: string,
	suppressedDomains: ReadonlySet<string>,
): boolean {
	const domain = organizationDomain(value);
	return domain ? suppressedDomains.has(domain) : false;
}

function dayKey(date: Date, timeZone: string): Date {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const value = (type: string) =>
		parts.find((part) => part.type === type)?.value ?? "01";
	return new Date(
		`${value("year")}-${value("month")}-${value("day")}T00:00:00.000Z`,
	);
}

function businessDaysBefore(date: Date, count: number): Date {
	const cursor = new Date(date);
	let remaining = count;
	while (remaining > 0) {
		cursor.setUTCDate(cursor.getUTCDate() - 1);
		const day = cursor.getUTCDay();
		if (day !== 0 && day !== 6) remaining -= 1;
	}
	return cursor;
}

export async function listAtlasOutreachQueue(ctx: PurposeContext) {
	assertAtlasSession(ctx);
	return withPrincipal(
		db,
		{ userId: ATLAS_OPERATOR_ID, kind: "service" },
		async (tx) => {
			const suppressedDomains = new Set(
				(
					await tx.suppressedDomain.findMany({
						select: { domain: true },
					})
				).map((row) => row.domain.toLowerCase()),
			);
			const leads = await tx.lead.findMany({
				where: {
					stage: { in: ["NEW", "READY"] },
					commercialQualityStatus: "SENDABLE",
					attentionState: "NONE",
					nextActionAt: { not: null, lte: new Date() },
					contact: {
						lifecycleState: "ACTIVE",
						outreachState: "ALLOWED",
						personProtections: { none: { status: "ACTIVE" } },
					},
				},
				orderBy: [{ priority: "desc" }, { nextActionAt: "asc" }],
				take: 100,
				select: {
					id: true,
					name: true,
					stage: true,
					priority: true,
					commercialQualityStatus: true,
					commercialQualityScore: true,
					commercialOpportunityCollisionKey: true,
					nextActionTitle: true,
					nextActionAt: true,
					contact: {
						select: {
							id: true,
							firstName: true,
							lastName: true,
							playerProfile: { select: { contactId: true } },
							email: true,
							title: true,
							company: {
								select: {
									name: true,
									organizationProtections: {
										where: { status: "ACTIVE" },
										select: { id: true },
									},
								},
							},
							channelEngagementStates: {
								where: {
									channel: "LINKEDIN",
									status: { in: ["ACTIVE_HUMAN_CONVERSATION", "NEEDS_IHSAN"] },
								},
								select: { id: true },
							},
							contactRoutes: {
								where: { type: "EMAIL" },
								select: { id: true, value: true, normalizedValue: true },
							},
						},
					},
				},
			});
			const eligible: typeof leads = [];
			for (const lead of leads) {
				if ((lead.contact?.company?.organizationProtections.length ?? 0) > 0)
					continue;
				if (
					lead.contact?.contactRoutes.some((route) =>
						isOrganizationSuppressed(route.normalizedValue, suppressedDomains),
					)
				)
					continue;
				if (
					lead.contact?.playerProfile &&
					(await isProtectedPlayerContact(
						tx,
						lead.contact.id,
						`${lead.contact.firstName} ${lead.contact.lastName ?? ""}`,
					))
				)
					continue;
				eligible.push(lead);
			}
			const ranked = rankCommercialOpportunities(
				eligible.map((lead) => ({
					...lead,
					id: lead.id,
					collisionKey: lead.commercialOpportunityCollisionKey ?? lead.id,
					score: lead.commercialQualityScore ?? 0,
				})),
			);
			return ranked.slice(0, 20);
		},
	);
}

export async function sendAtlasEmail(ctx: PurposeContext, input: AtlasInput) {
	assertAtlasSession(ctx);
	const copyValidation = validateExternalCopy(input);
	if (!copyValidation.valid) throw new Error(copyValidation.reason);
	if (!atlasEnabled()) throw new Error("ATLAS_LIVE_OUTREACH_ENABLED is false.");
	if (!input.subject.trim() || !input.body.trim())
		throw new Error("Subject and body are required.");
	if (input.subject.length > 300 || input.body.length > 50_000)
		throw new Error("Email content is too long.");
	if (hasBlockedPricingLanguage(`${input.subject}\n${input.body}`))
		throw new Error("Pricing language is not allowed in external outreach.");
	if (hasUnsupportedOutcomeClaim(`${input.subject}\n${input.body}`))
		throw new Error(
			"Unsupported guarantees or client-outcome claims are not allowed in external outreach.",
		);
	const language = input.language.trim().toLowerCase();
	if (!isAtlasLanguageAllowed(language))
		throw new Error("Atlas may send only in English, Dutch, or Turkish.");

	let evaluatedInput: CommercialQualityInput | null = null;
	return withPrincipal(
		db,
		{ userId: ATLAS_OPERATOR_ID, kind: "service" },
		async (tx) => {
			const now = new Date();
			const [settings, lead, mailbox, authorization] = await Promise.all([
				tx.appSetting.findUnique({
					where: { id: "app" },
					select: {
						atlasLiveOutreachEnabled: true,
						atlasWorkingTimeZone: true,
						atlasWorkStartMinute: true,
						atlasWorkEndMinute: true,
						atlasDailyColdEmailLimit: true,
						atlasCooldownMinutes: true,
					},
				}),
				tx.lead.findUnique({
					where: { id: input.leadId },
					select: {
						id: true,
						stage: true,
						nextActionAt: true,
						nextActionTitle: true,
						attentionState: true,
						contactId: true,
						contact: {
							select: {
								id: true,
								companyId: true,
								firstName: true,
								lastName: true,
								lifecycleState: true,
								outreachState: true,
								email: true,
								company: {
									select: { id: true, name: true, domain: true },
								},
							},
						},
					},
				}),
				tx.mailbox.findFirst({
					where: {
						status: "VERIFIED",
						address: "outreach@iblmedia.com",
					},
					orderBy: { createdAt: "asc" },
					select: { id: true },
				}),
				tx.outreachAuthorization.findFirst({
					where: {
						scope: "STANDARD_COLD_OUTREACH",
						status: "ACTIVE",
						OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
					},
					orderBy: { issuedAt: "desc" },
					select: { id: true },
				}),
			]);
			if (!settings?.atlasLiveOutreachEnabled)
				throw new Error("Atlas outreach is disabled in CRM settings.");
			if (!authorization)
				throw new Error("ATLAS_OUTREACH_AUTHORIZATION_REQUIRED");
			const existingDraft = await tx.draft.findUnique({
				where: { idempotencyKey: input.idempotencyKey },
				select: { id: true, language: true },
			});
			if (existingDraft) {
				const existingDelivery = await tx.outboundDelivery.findFirst({
					where: { draftId: existingDraft.id },
					orderBy: { createdAt: "asc" },
					select: { id: true, status: true },
				});
				if (!existingDelivery)
					throw new Error("OUTBOUND_IDEMPOTENCY_DELIVERY_MISSING");
				return {
					draftId: existingDraft.id,
					deliveryId: existingDelivery.id,
					status: existingDelivery.status,
					language: existingDraft.language ?? language,
				};
			}
			if (
				!isWithinAtlasWorkingHours(
					now,
					settings.atlasWorkingTimeZone,
					settings.atlasWorkStartMinute,
					settings.atlasWorkEndMinute,
				)
			)
				throw new Error("Outside Atlas working hours.");
			if (
				!lead?.contactId ||
				!lead.contact ||
				!isAtlasContactEligible(
					lead.contact.lifecycleState,
					lead.contact.outreachState,
					lead.attentionState,
				)
			)
				throw new Error("Lead contact is not eligible for outreach.");
			if (await isPersonProtected(tx, lead.contact.id))
				throw new Error("PERSON_OWNER_PROTECTED");
			if (
				await isProtectedPlayerContact(
					tx,
					lead.contact.id,
					`${lead.contact.firstName} ${lead.contact.lastName ?? ""}`,
				)
			)
				throw new Error("Protected players cannot be prospecting targets.");
			const organizationProtection = lead.contact.companyId
				? await tx.organizationProtection.findFirst({
						where: { companyId: lead.contact.companyId, status: "ACTIVE" },
						select: { id: true },
					})
				: null;
			if (organizationProtection)
				throw new Error(
					"Organization is protected by an explicit owner override.",
				);
			if (!mailbox)
				throw new Error(
					"A verified mailbox is required as the outbound envelope.",
				);
			if (lead.stage !== "NEW" && lead.stage !== "READY")
				throw new Error("Lead is no longer in a sendable stage.");
			if (!lead.nextActionAt || !lead.nextActionTitle)
				throw new Error(
					"Every active lead must have a next action before outreach.",
				);
			const route = await tx.contactRoute.findFirst({
				where: {
					id: input.routeId,
					lifecycleState: "ACTIVE",
					contactId: lead.contactId,
					type: "EMAIL",
				},
				select: { id: true, normalizedValue: true },
			});
			if (!route)
				throw new Error(
					"The email route is not attached to this lead contact.",
				);
			await tx.$executeRaw(
				Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`atlas-relationship:${lead.contactId}`}))`,
			);
			const commercial = input.commercial ?? {};
			const candidateOrganization = commercial.organization?.trim() ?? "";
			const candidatePlayer = commercial.playerOrOpportunity?.trim() ?? "";
			const candidatePurpose = commercial.campaignPurpose?.trim() ?? "";
			await tx.$executeRaw(
				Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`atlas-commercial-organization:${lead.contact.companyId ?? candidateOrganization}`}))`,
			);
			const candidateCollisionKey =
				candidateOrganization && candidatePlayer && candidatePurpose
					? opportunityCollisionKey({
							organization: candidateOrganization,
							playerOrOpportunity: candidatePlayer,
							campaignPurpose: candidatePurpose,
						})
					: null;
			const [
				consent,
				suppressed,
				suppressedOrganization,
				activePlan,
				activeLinkedInConversation,
				sharedSuppressions,
				recent,
				existingOpportunity,
				organizationOpportunities,
			] = await Promise.all([
				tx.contactRouteConsent.findUnique({
					where: { routeId: route.id },
					select: { status: true },
				}),
				tx.suppressedContact.findUnique({
					where: { email: route.normalizedValue },
					select: { email: true },
				}),
				tx.suppressedDomain.findUnique({
					where: {
						domain: organizationDomain(route.normalizedValue) ?? "",
					},
					select: { domain: true },
				}),
				tx.followUpPlan.findFirst({
					where: {
						contactId: lead.contactId,
						channel: "EMAIL",
						status: "ACTIVE",
					},
					select: { id: true },
				}),
				tx.channelEngagementState.findFirst({
					where: {
						contactId: lead.contactId,
						channel: "LINKEDIN",
						status: { in: ["ACTIVE_HUMAN_CONVERSATION", "NEEDS_IHSAN"] },
					},
					select: { status: true },
				}),
				tx.outreachSuppression.findMany({
					where: {
						OR: [
							{ scope: "CONTACT", contactId: lead.contactId },
							{
								scope: "ROUTE",
								contactId: lead.contactId,
								channel: "EMAIL",
							},
							...(lead.contact.companyId
								? [
										{
											scope: "ORGANIZATION" as const,
											companyId: lead.contact.companyId,
										},
									]
								: []),
						],
					},
					select: { id: true, scope: true, reason: true },
				}),
				tx.outboundDelivery.findFirst({
					where: {
						draft: { recipientRoute: { contactId: lead.contactId } },
						status: { notIn: ["CANCELLED", "FAILED"] },
					},
					orderBy: { createdAt: "desc" },
					select: { createdAt: true },
				}),
				candidateCollisionKey
					? tx.lead.findFirst({
							where: {
								id: { not: lead.id },
								commercialOpportunityCollisionKey: candidateCollisionKey,
								stage: { notIn: ["LOST", "WON"] },
								status: { not: "DISQUALIFIED" },
							},
							select: { id: true },
						})
					: Promise.resolve(null),
				lead.contact.companyId
					? tx.lead.findMany({
							where: {
								id: { not: lead.id },
								companyId: lead.contact.companyId,
								commercialOpportunityCollisionKey: { not: null },
								lastContactedAt: { gte: businessDaysBefore(now, 5) },
								stage: { notIn: ["LOST", "WON"] },
								status: { not: "DISQUALIFIED" },
							},
							select: { commercialOpportunityCollisionKey: true },
						})
					: Promise.resolve([]),
			]);
			if (
				consent?.status === "DO_NOT_CONTACT" ||
				suppressed ||
				suppressedOrganization
			)
				throw new Error("Global or route suppression blocks outreach.");
			if (sharedSuppressions.length > 0)
				throw new Error(
					"The contact or organization is suppressed for this outreach.",
				);
			const coldTouchClaim = await tx.relationshipColdTouchClaim.findUnique({
				where: { contactId: lead.contactId },
				select: { id: true, status: true, idempotencyKey: true },
			});
			const organizationOpportunityKeys = new Set(
				organizationOpportunities
					.map((item) => item.commercialOpportunityCollisionKey)
					.filter((key): key is string => Boolean(key)),
			);
			const qualityInput: CommercialQualityInput = {
				...commercial,
				organization: candidateOrganization,
				playerOrOpportunity: candidatePlayer,
				campaignPurpose: candidatePurpose,
				requestedLanguage: language,
				currentClub: commercial.currentClub ?? null,
				currentClubVerified: commercial.currentClubVerified ?? false,
				currentClubRequired: commercial.currentClubRequired,
				identityResolved:
					commercial.identityResolved ?? Boolean(candidatePlayer),
				organizationResolved:
					commercial.organizationResolved ?? Boolean(candidateOrganization),
				playerOrganizationAssociationResolved:
					commercial.playerOrganizationAssociationResolved ?? false,
				whyNowSupported: commercial.whyNowSupported ?? false,
				whyNowRequired: commercial.whyNowRequired ?? false,
				subject: input.subject,
				body: input.body,
				activeRelationship: Boolean(activeLinkedInConversation || activePlan),
				contactOnceClaimed: Boolean(
					coldTouchClaim &&
						coldTouchClaim.status !== "RELEASED" &&
						coldTouchClaim.idempotencyKey !== input.idempotencyKey,
				),
				opportunityAlreadyActive: Boolean(existingOpportunity),
				activeOrganizationOpportunityCount: organizationOpportunityKeys.size,
				language: {
					...commercial.language,
					organizationDomain:
						commercial.language?.organizationDomain ??
						lead.contact.company?.domain,
					organizationName:
						commercial.language?.organizationName ?? lead.contact.company?.name,
				},
			};
			evaluatedInput = qualityInput;
			const quality = evaluateCommercialQuality(qualityInput);
			await tx.lead.update({
				where: { id: lead.id },
				data: commercialQualityUpdateData(quality, now, qualityInput),
			});
			if (quality.status !== "SENDABLE") {
				throw new CommercialQualityBlockedError(quality);
			}
			if (activeLinkedInConversation)
				throw new Error(
					"An active LinkedIn relationship requires coordination before cold email.",
				);
			if (activePlan)
				throw new Error(
					"An active outreach sequence already exists for this contact.",
				);
			if (
				coldTouchClaim &&
				coldTouchClaim.status !== "RELEASED" &&
				coldTouchClaim.idempotencyKey !== input.idempotencyKey
			)
				throw new Error(
					"A cold first touch has already been claimed across channels.",
				);
			if (!coldTouchClaim) {
				await tx.relationshipColdTouchClaim.create({
					data: {
						contactId: lead.contactId,
						leadId: lead.id,
						channel: "EMAIL",
						status: "CLAIMED",
						idempotencyKey: input.idempotencyKey,
					},
				});
			} else if (coldTouchClaim.status === "RELEASED") {
				await tx.relationshipColdTouchClaim.update({
					where: { id: coldTouchClaim.id },
					data: {
						leadId: lead.id,
						channel: "EMAIL",
						status: "CLAIMED",
						idempotencyKey: input.idempotencyKey,
						claimedAt: new Date(),
						releasedAt: null,
					},
				});
			}
			if (
				recent &&
				now.getTime() - recent.createdAt.getTime() <
					settings.atlasCooldownMinutes * 60_000
			)
				throw new Error("Contact cooldown blocks outreach.");
			const day = dayKey(now, settings.atlasWorkingTimeZone);
			await tx.outreachQuota.upsert({
				where: { day },
				create: {
					day,
					coldEmailLimit: Math.min(90, settings.atlasDailyColdEmailLimit),
				},
				update: {},
			});
			const reserved = await tx.$queryRaw<{ id: string }[]>(
				Prisma.sql`UPDATE "outreachQuota" SET "coldEmailReserved" = "coldEmailReserved" + 1, "updatedAt" = NOW() WHERE "day" = ${day} AND "coldEmailReserved" + "coldEmailSent" < LEAST("coldEmailLimit", ${Math.min(90, settings.atlasDailyColdEmailLimit)}) RETURNING "id"`,
			);
			if (reserved.length === 0)
				throw new Error("Daily cold-email quota is exhausted.");
			const draft = await tx.draft.upsert({
				where: { idempotencyKey: input.idempotencyKey },
				create: {
					ownerUserId: ATLAS_OPERATOR_ID,
					mailboxId: mailbox.id,
					recipientRouteId: route.id,
					leadId: lead.id,
					subject: input.subject.trim(),
					body: input.body.trim(),
					language,
					coldOutreach: true,
					status: "QUEUED",
					approvedAt: now,
					atlasAuthorizedAt: now,
					atlasPolicyVersion: POLICY_VERSION,
					authorizationId: authorization.id,
					idempotencyKey: input.idempotencyKey,
				},
				update: {},
				select: { id: true, status: true },
			});
			const delivery = await tx.outboundDelivery.upsert({
				where: { idempotencyKey: `ibl-outbound:${draft.id}` },
				create: {
					draftId: draft.id,
					idempotencyKey: `ibl-outbound:${draft.id}`,
				},
				update: {},
				select: { id: true, status: true },
			});
			await tx.domainAuditEvent.create({
				data: {
					actorUserId: ATLAS_OPERATOR_ID,
					action: "ATLAS_OUTREACH_QUEUED",
					entityType: "DRAFT",
					entityId: draft.id,
					outcome: "SUCCESS",
					requestId: input.idempotencyKey,
					metadata: {
						leadId: lead.id,
						routeId: route.id,
						language,
						policyVersion: POLICY_VERSION,
					},
				},
			});
			return {
				draftId: draft.id,
				deliveryId: delivery.id,
				status: delivery.status,
				language,
			};
		},
	).catch(async (error) => {
		if (!(error instanceof CommercialQualityBlockedError)) throw error;
		await withPrincipal(
			db,
			{ userId: ATLAS_OPERATOR_ID, kind: "service" },
			async (tx) => {
				await tx.lead.update({
					where: { id: input.leadId },
					data: {
						...commercialQualityUpdateData(
							error.result,
							new Date(),
							evaluatedInput ?? {
								organization: "",
								playerOrOpportunity: "",
								campaignPurpose: "",
							},
						),
						commercialEnrichmentStatus: canRetryCommercialQuality(error.result)
							? "QUEUED"
							: "EXHAUSTED",
						commercialEnrichmentReason: error.result.reasons
							.map((item) => item.code)
							.join(",")
							.slice(0, 500),
						commercialEnrichmentNextAttemptAt: canRetryCommercialQuality(
							error.result,
						)
							? new Date()
							: null,
					},
				});
			},
		);
		if (canRetryCommercialQuality(error.result)) {
			const lead = await db.lead.findUnique({
				where: { id: input.leadId },
				select: { contactId: true, companyId: true },
			});
			await scheduleTask({
				leadId: input.leadId,
				contactId: lead?.contactId,
				companyId: lead?.companyId,
				kind: "atlas-commercial-enrichment",
				reason: `Recover missing Atlas commercial evidence: ${error.result.reasons
					.map((item) => item.code)
					.join(", ")}`,
				dueAt: new Date(),
				priority: 85,
				budget: 4,
			});
		}
		throw error;
	});
}
