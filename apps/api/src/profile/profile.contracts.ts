import { z } from "zod";

export const updateOwnProfileInput = z.object({
	preferredLanguage: z.string().trim().min(1).max(80),
	locale: z.string().trim().min(2).max(35),
	timeZone: z.string().trim().min(1).max(80),
	workingPreferences: z.record(z.string(), z.unknown()),
});
