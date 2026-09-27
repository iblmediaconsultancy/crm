import { z } from "zod";

export const mailboxThreadInput = z.object({ threadId: z.string().cuid() });
export const mailboxEventInput = z.object({ eventId: z.string().cuid() });

export const mailboxIdInput = z.object({
	mailboxId: z.string().min(1),
});

export const updateOwnedMailboxIdentityInput = mailboxIdInput.extend({
	address: z.string().trim().email().max(320),
	displayName: z.string().trim().max(120).nullable(),
	signature: z.string().max(4000).nullable(),
});
