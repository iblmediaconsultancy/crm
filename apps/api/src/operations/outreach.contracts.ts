import { z } from "zod";
export const routeConsentInput = z.object({ routeId: z.string().min(1), status: z.enum(["ALLOWED", "DO_NOT_CONTACT"]), reason: z.string().trim().min(3).max(500), source: z.string().trim().min(2).max(100) });
export const followUpPlanCreateInput = z.object({ contactId: z.string().min(1), routeId: z.string().min(1), steps: z.array(z.object({ dueAt: z.coerce.date(), draftId: z.string().min(1) })).min(1).max(20) });
export const followUpCancelInput = z.object({ planId: z.string().min(1), reason: z.string().trim().min(3).max(500) });