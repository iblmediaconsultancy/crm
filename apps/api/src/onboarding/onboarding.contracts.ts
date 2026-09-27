import { z } from "zod";

export const invitationIdInput = z.object({ invitationId: z.string().uuid() });

export const inviteMemberInput = z.object({
	email: z.email().transform((value) => value.trim().toLowerCase()),
	role: z.enum(["team", "contributor"]),
	expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const acceptInvitationInput = z.object({
	invitationId: z.string().uuid(),
	name: z.string().trim().min(2).max(120),
	password: z.string().min(12).max(128),
});

export const pendingInvitationsInput = z.object({
	take: z.number().int().min(1).max(100).default(50),
});