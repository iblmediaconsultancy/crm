import { db, Prisma } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import type { PurposeContext } from "./session-purpose";
import { attribute, purposeOf } from "./session-purpose";

export const ATLAS_OPERATOR_ID = "atlas-operator";
const POLICY_VERSION = "atlas-v1";
const LANGUAGES = new Set(["english", "dutch", "turkish"]);
const BLOCKED_PRICING = /(?:pricing|price|prices|cost|budget|fee|fees|€|\$|£)/i;

type AtlasInput = {
	leadId: string;
	routeId: string;
	subject: string;
	body: string;
	language: string;
	idempotencyKey: string;
};

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
	return BLOCKED_PRICING.test(value);
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

export async function listAtlasOutreachQueue(ctx: PurposeContext) {
	assertAtlasSession(ctx);
	return withPrincipal(
		db,
		{ userId: ATLAS_OPERATOR_ID, kind: "service" },
		async (tx) =>
			tx.lead.findMany({
				where: {
					stage: { in: ["NEW", "READY"] },
					attentionState: "NONE",
					nextActionAt: { not: null, lte: new Date() },
					contact: { lifecycleState: "ACTIVE", outreachState: "ALLOWED" },
				},
				orderBy: [{ priority: "desc" }, { nextActionAt: "asc" }],
				take: 20,
				select: {
					id: true,
					name: true,
					stage: true,
					priority: true,
					nextActionTitle: true,
					nextActionAt: true,
					contact: {
						select: {
							id: true,
							firstName: true,
							lastName: true,
							email: true,
							title: true,
							company: { select: { name: true } },
							contactRoutes: {
								where: { type: "EMAIL" },
								select: { id: true, value: true, normalizedValue: true },
								take: 1,
							},
						},
					},
				},
			}),
	);
}

export async function sendAtlasEmail(ctx: PurposeContext, input: AtlasInput) {
	assertAtlasSession(ctx);
	if (!atlasEnabled()) throw new Error("ATLAS_LIVE_OUTREACH_ENABLED is false.");
	if (!input.subject.trim() || !input.body.trim())
		throw new Error("Subject and body are required.");
	if (input.subject.length > 300 || input.body.length > 50_000)
		throw new Error("Email content is too long.");
	if (hasBlockedPricingLanguage(`${input.subject}\n${input.body}`))
		throw new Error("Pricing language is not allowed in external outreach.");
	const language = input.language.trim().toLowerCase();
	if (!LANGUAGES.has(language))
		throw new Error("Atlas may send only in English, Dutch, or Turkish.");

	return withPrincipal(
		db,
		{ userId: ATLAS_OPERATOR_ID, kind: "service" },
		async (tx) => {
			const now = new Date();
			const [settings, lead, mailbox] = await Promise.all([
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
								lifecycleState: true,
								outreachState: true,
								email: true,
							},
						},
					},
				}),
				tx.mailbox.findFirst({
					where: { status: "VERIFIED" },
					orderBy: { createdAt: "asc" },
					select: { id: true },
				}),
			]);
			if (!settings?.atlasLiveOutreachEnabled)
				throw new Error("Atlas outreach is disabled in CRM settings.");
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
				lead.contact.lifecycleState !== "ACTIVE" ||
				lead.contact.outreachState !== "ALLOWED"
			)
				throw new Error("Lead contact is not eligible for outreach.");
			if (!mailbox)
				throw new Error(
					"A verified mailbox is required as the outbound envelope.",
				);
			if (lead.stage !== "NEW" && lead.stage !== "READY")
				throw new Error("Lead is no longer in a sendable stage.");
			if (lead.attentionState !== "NONE")
				throw new Error("Lead attention state blocks autonomous outreach.");
			if (!lead.nextActionAt || !lead.nextActionTitle)
				throw new Error(
					"Every active lead must have a next action before outreach.",
				);
			const route = await tx.contactRoute.findFirst({
				where: { id: input.routeId, contactId: lead.contactId, type: "EMAIL" },
				select: { id: true, normalizedValue: true },
			});
			if (!route)
				throw new Error(
					"The email route is not attached to this lead contact.",
				);
			const [consent, suppressed, activePlan, recent] = await Promise.all([
				tx.contactRouteConsent.findUnique({
					where: { routeId: route.id },
					select: { status: true },
				}),
				tx.suppressedContact.findUnique({
					where: { email: route.normalizedValue },
					select: { email: true },
				}),
				tx.followUpPlan.findFirst({
					where: { contactId: lead.contactId, status: "ACTIVE" },
					select: { id: true },
				}),
				tx.outboundDelivery.findFirst({
					where: {
						draft: { recipientRoute: { contactId: lead.contactId } },
						status: { notIn: ["CANCELLED", "FAILED"] },
					},
					orderBy: { createdAt: "desc" },
					select: { createdAt: true },
				}),
			]);
			if (consent?.status === "DO_NOT_CONTACT" || suppressed)
				throw new Error("Global or route suppression blocks outreach.");
			if (activePlan)
				throw new Error(
					"An active outreach sequence already exists for this contact.",
				);
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
	);
}
