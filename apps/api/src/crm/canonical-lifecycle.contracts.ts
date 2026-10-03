import { z } from "zod";

export const canonicalLifecycleInput = z.object({
	id: z.string().min(1),
	version: z.number().int().positive(),
	reason: z.string().trim().min(3).max(500),
});

export type CanonicalLifecycleInput = z.infer<typeof canonicalLifecycleInput>;

export const canonicalBulkLifecycleInput = z.object({
	ids: z
		.array(z.string().min(1))
		.min(1)
		.max(100)
		.transform((ids) => [...new Set(ids)]),
	reason: z.string().trim().min(3).max(500),
});

export const canonicalDeletionImpactInput = z.object({
	id: z.string().min(1),
});

export const canonicalDestructiveDeleteInput = z.object({
	id: z.string().min(1),
	confirmationToken: z.string().min(40).max(2000),
	canonicalName: z.string().trim().min(1).max(300),
	reason: z.string().trim().min(10).max(1000),
});
