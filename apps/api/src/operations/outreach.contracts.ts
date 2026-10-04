import { z } from "zod";
export const routeConsentInput = z.object({
	routeId: z.string().min(1),
	status: z.enum(["ALLOWED", "DO_NOT_CONTACT"]),
	reason: z.string().trim().min(3).max(500),
	source: z.string().trim().min(2).max(100),
});
export const followUpPlanCreateInput = z.object({
	contactId: z.string().min(1),
	routeId: z.string().min(1),
	leadId: z.string().min(1).nullable().optional(),
	steps: z
		.array(z.object({ dueAt: z.coerce.date(), draftId: z.string().min(1) }))
		.min(1)
		.max(3),
});
export const followUpCancelInput = z.object({
	planId: z.string().min(1),
	reason: z.string().trim().min(3).max(500),
});
export const localReplyInput = z.object({
	deliveryId: z.string().min(1),
	body: z.string().trim().min(1).max(10000),
});
export const atlasAuthorizationIssueInput = z.object({
	expiresAt: z.coerce.date().nullable().optional(),
	followUpCohortId: z.string().min(1).nullable().optional(),
});
export const followUpCohortPrepareInput = z.object({
	stepIds: z.array(z.string().min(1)).min(1).max(500),
});
export const atlasAuthorizationRevokeInput = z.object({
	id: z.string().min(1),
	reason: z.string().trim().min(3).max(500),
});
