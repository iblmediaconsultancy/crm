import { z } from "zod";

const email = z
	.string()
	.trim()
	.email()
	.transform((value) => value.toLowerCase());

export const meetingRequestInput = z
	.object({
		leadId: z.string().min(1).optional(),
		contactId: z.string().min(1).optional(),
		title: z.string().trim().min(1).max(200),
		description: z.string().trim().max(5000).optional(),
		startsAt: z.string().datetime({ offset: true }),
		endsAt: z.string().datetime({ offset: true }),
		timeZone: z.string().trim().min(1).max(80).default("Europe/Amsterdam"),
		attendeeEmails: z.array(email).max(20).default([]),
		calendarId: z.string().trim().min(1).max(200).default("primary"),
	})
	.refine(
		(value) => Boolean(value.leadId || value.contactId),
		"A lead or contact is required.",
	);

export const meetingIdInput = z.object({ id: z.string().min(1) });

export const meetingAvailabilityInput = z.object({
	startsAt: z.string().datetime({ offset: true }),
	endsAt: z.string().datetime({ offset: true }),
});

export type MeetingRequestInput = z.infer<typeof meetingRequestInput>;
