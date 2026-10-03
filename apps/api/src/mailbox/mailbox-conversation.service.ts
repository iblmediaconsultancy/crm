import type { Db } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

@Injectable()
export class MailboxConversationService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async thread(userId: string, threadId: string) {
		await this.assertThreadAccess(userId, threadId);
		const thread = await this.db.emailThread.findUnique({
			where: { id: threadId },
			select: {
				id: true,
				subject: true,
				messageCount: true,
				firstMessageAt: true,
				lastMessageAt: true,
				company: { select: { id: true, name: true } },
				contact: { select: { id: true, firstName: true, lastName: true } },
				messages: {
					orderBy: { sentAt: "asc" },
					select: {
						id: true,
						direction: true,
						fromEmail: true,
						fromName: true,
						recipients: true,
						subject: true,
						body: true,
						snippet: true,
						sentAt: true,
					},
				},
			},
		});
		if (!thread) throw new NotFoundException("Email thread not found.");
		const faces = await this.facesFor(
			thread.messages.map((message) => message.fromEmail),
		);
		return {
			...thread,
			firstMessageAt: thread.firstMessageAt.toISOString(),
			lastMessageAt: thread.lastMessageAt.toISOString(),
			messages: thread.messages.map((message) => ({
				...message,
				sentAt: message.sentAt.toISOString(),
				recipients: recipientsOf(message.recipients),
				fromImageUrl: faces.get(message.fromEmail.toLowerCase()) ?? null,
				mailboxUrl: null,
				mailboxName: null,
			})),
		};
	}

	async event(userId: string, eventId: string) {
		await this.assertEventAccess(userId, eventId);
		const event = await this.db.calendarEvent.findUnique({
			where: { id: eventId },
			select: {
				id: true,
				title: true,
				description: true,
				location: true,
				conferenceUrl: true,
				startsAt: true,
				endsAt: true,
				isAllDay: true,
				status: true,
				organizerEmail: true,
				company: { select: { id: true, name: true } },
				contact: { select: { id: true, firstName: true, lastName: true } },
				attendees: {
					orderBy: [{ isOrganizer: "desc" }, { email: "asc" }],
					select: {
						id: true,
						email: true,
						name: true,
						responseStatus: true,
						isOrganizer: true,
						contactId: true,
						contact: { select: { imageUrl: true } },
					},
				},
			},
		});
		if (!event) throw new NotFoundException("Calendar event not found.");
		return {
			...event,
			startsAt: event.startsAt.toISOString(),
			endsAt: event.endsAt.toISOString(),
			attendees: event.attendees.map(({ contact, ...attendee }) => ({
				...attendee,
				imageUrl: contact?.imageUrl ?? null,
			})),
		};
	}

	private async assertThreadAccess(userId: string, threadId: string) {
		const accessible = await withPrincipal(
			this.db,
			{ userId, kind: "user" },
			(tx) =>
				tx.emailThread.findUnique({
					where: { id: threadId },
					select: { id: true },
				}),
		);
		if (!accessible) throw new NotFoundException("Email thread not found.");
	}

	private async assertEventAccess(userId: string, eventId: string) {
		const accessible = await withPrincipal(
			this.db,
			{ userId, kind: "user" },
			(tx) =>
				tx.activity.findFirst({
					where: { calendarEventId: eventId, lifecycleState: "ACTIVE" },
					select: { id: true },
				}),
		);
		if (!accessible) throw new NotFoundException("Calendar event not found.");
	}

	private async facesFor(addresses: string[]) {
		const emails = [
			...new Set(addresses.map((address) => address.toLowerCase())),
		];
		if (emails.length === 0) return new Map<string, string>();
		const [contacts, users] = await Promise.all([
			this.db.contact.findMany({
				where: {
					email: { in: emails, mode: "insensitive" },
					lifecycleState: "ACTIVE",
				},
				select: { email: true, imageUrl: true },
			}),
			this.db.user.findMany({
				where: { email: { in: emails, mode: "insensitive" } },
				select: { email: true, image: true },
			}),
		]);
		const faces = new Map<string, string>();
		for (const contact of contacts) {
			if (contact.email && contact.imageUrl)
				faces.set(contact.email.toLowerCase(), contact.imageUrl);
		}
		for (const user of users)
			if (user.image) faces.set(user.email.toLowerCase(), user.image);
		return faces;
	}
}

function recipientsOf(
	value: unknown,
): { email: string; name: string | null; kind: string }[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		if (typeof entry !== "object" || entry === null) return [];
		const record = entry as Record<string, unknown>;
		if (typeof record.email !== "string") return [];
		return [
			{
				email: record.email,
				name: typeof record.name === "string" ? record.name : null,
				kind: typeof record.kind === "string" ? record.kind : "to",
			},
		];
	});
}
