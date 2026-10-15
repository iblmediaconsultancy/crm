import { z } from "zod";

const id = z.string().trim().min(1).max(191);

export const linkedinManualBatchInput = z.object({
	limit: z.number().int().min(1).max(20).default(20),
});

export const linkedinManualPrepareInput = z.object({
	contactId: id,
	routeId: id,
	conversationId: id.nullable().optional(),
	type: z.enum([
		"REPLY",
		"WARM_FOLLOW_UP",
		"CONNECTION_REQUEST",
		"FIRST_MESSAGE",
	]),
	body: z.string().trim().max(3000).nullable().optional(),
	whyNow: z.string().trim().min(8).max(1000),
	idempotencyKey: z.string().trim().min(16).max(191),
});

export const linkedinManualCompleteInput = z.object({
	id: id,
	occurredAt: z.string().datetime().optional(),
});

export const linkedinManualCancelInput = z.object({ id });

export const linkedinManualRelationshipInput = z.object({
	contactId: id,
	routeId: id,
	profileUrl: z.string().url().max(500),
	profileIdentifier: z.string().trim().min(2).max(191),
	stableMemberIdentifier: z.string().trim().max(191).nullable().optional(),
	state: z.enum([
		"UNKNOWN",
		"NOT_CONNECTED",
		"PENDING_SENT",
		"PENDING_RECEIVED",
		"CONNECTED",
		"DECLINED",
		"WITHDRAWN",
	]),
	observedAt: z.string().datetime(),
});
