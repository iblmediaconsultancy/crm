import { z } from "zod";

export const duplicateListInput = z.object({
	q: z.string().trim().max(120).default(""),
	take: z.number().int().min(1).max(100).default(50),
});

export const duplicateCandidateInput = z.object({
	candidateId: z.string().min(1),
});

export const duplicateDismissInput = duplicateCandidateInput.extend({
	reason: z.string().trim().min(3).max(500),
});

export const duplicateMergeInput = duplicateCandidateInput.extend({
	survivorSide: z.enum(["left", "right"]),
	reason: z.string().trim().min(3).max(500),
	idempotencyKey: z.string().min(8).max(200),
	fieldChoices: z.record(z.string(), z.enum(["left", "right"])).default({}),
});
