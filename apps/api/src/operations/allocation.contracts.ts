import { z } from "zod";

export const allocationEntityType = z.enum([
	"COMPANY",
	"CONTACT",
	"PLAYER",
	"FOOTBALL_AGENT",
	"AGENCY",
	"CLUB",
	"LEAD",
	"DEAL",
]);
export const allocationTargetInput = z.object({
	entityType: allocationEntityType,
	entityId: z.string().min(1),
});
export const allocationPolicyCreateInput = z.object({
	name: z.string().trim().min(3).max(100),
	rules: z
		.object({
			priorityUserIds: z.array(z.string()).default([]),
			defaultCapacity: z.number().int().min(1).max(10000).default(25),
		})
		.passthrough(),
});
export const allocationPolicyActivateInput = z.object({
	policyId: z.string().min(1),
});
export const allocationEnqueueInput = allocationTargetInput.extend({
	idempotencyKey: z.string().min(8).max(200),
});
export const allocationOverrideInput = allocationTargetInput.extend({
	assigneeUserId: z.string().min(1),
	reason: z.string().trim().min(3).max(500),
});
