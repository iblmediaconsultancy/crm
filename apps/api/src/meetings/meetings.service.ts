import { type Db, Prisma } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import type { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import { GoogleCalendarService } from "./google-calendar.service";
import type { meetingRequestInput } from "./meetings.contracts";

type Input<T extends z.ZodType> = z.infer<T>;

@Injectable()
export class MeetingsService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly google: GoogleCalendarService,
	) {}

	status(userId: string) {
		return this.google.status(userId);
	}

	availability(userId: string, startsAt: string, endsAt: string) {
		return this.google.availability(
			userId,
			new Date(startsAt),
			new Date(endsAt),
		);
	}

	async request(userId: string, input: Input<typeof meetingRequestInput>) {
		const startsAt = new Date(input.startsAt);
		const endsAt = new Date(input.endsAt);
		if (endsAt <= startsAt)
			throw new BadRequestException("Meeting end must be after its start.");
		const availability = await this.google
			.availability(userId, startsAt, endsAt)
			.catch((error) => ({
				status: "NOT_CONNECTED" as const,
				reason: error instanceof Error ? error.message : String(error),
			}));
		return withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			const [lead, contact] = await Promise.all([
				input.leadId
					? tx.lead.findFirst({
							where: { id: input.leadId },
							select: { id: true },
						})
					: null,
				input.contactId
					? tx.contact.findFirst({
							where: { id: input.contactId },
							select: { id: true },
						})
					: null,
			]);
			if (input.leadId && !lead) throw new NotFoundException("Lead not found.");
			if (input.contactId && !contact)
				throw new NotFoundException("Contact not found.");
			return tx.meetingRequest.create({
				data: {
					leadId: input.leadId ?? null,
					contactId: input.contactId ?? null,
					requestedByUserId: userId,
					title: input.title,
					description: input.description ?? null,
					startsAt,
					endsAt,
					timeZone: input.timeZone,
					attendeeEmails: input.attendeeEmails,
					calendarId: input.calendarId,
					availability: availability,
				},
			});
		});
	}

	async approve(userId: string, id: string, note?: string) {
		return withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			await this.requireManager(tx, userId);
			const request = await tx.meetingRequest.findUnique({ where: { id } });
			if (!request) throw new NotFoundException("Meeting request not found.");
			if (request.status !== "PENDING_APPROVAL")
				throw new BadRequestException("Only pending meetings can be approved.");
			return tx.meetingRequest.update({
				where: { id },
				data: {
					status: "APPROVED",
					approvedByUserId: userId,
					approvedAt: new Date(),
					approvalNote: note ?? null,
				},
			});
		});
	}

	async decline(userId: string, id: string, note?: string) {
		return withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			await this.requireManager(tx, userId);
			const request = await tx.meetingRequest.findUnique({ where: { id } });
			if (!request) throw new NotFoundException("Meeting request not found.");
			if (request.status !== "PENDING_APPROVAL")
				throw new BadRequestException("Only pending meetings can be declined.");
			return tx.meetingRequest.update({
				where: { id },
				data: { status: "DECLINED", approvalNote: note ?? null },
			});
		});
	}

	async confirm(userId: string, id: string) {
		const request = await withPrincipal(
			this.db,
			{ userId, kind: "user" },
			async (tx) => {
				await this.requireManager(tx, userId);
				const row = await tx.meetingRequest.findUnique({ where: { id } });
				if (!row) throw new NotFoundException("Meeting request not found.");
				if (row.status !== "APPROVED")
					throw new BadRequestException(
						"Meeting approval is required before confirmation.",
					);
				return row;
			},
		);
		const availability = await this.google.availability(
			userId,
			request.startsAt,
			request.endsAt,
		);
		if (availability.status !== "AVAILABLE") {
			await withPrincipal(this.db, { userId, kind: "user" }, (tx) =>
				tx.meetingRequest.update({
					where: { id },
					data: {
						status: "BLOCKED",
						blockedReason: "The IBL or HvA calendar is busy.",
						availability,
					},
				}),
			);
			throw new BadRequestException(
				"The requested time is unavailable on the IBL or HvA calendar.",
			);
		}
		const event = await this.google.createEvent(userId, {
			calendarId: request.calendarId,
			title: request.title,
			description: request.description ?? undefined,
			startsAt: request.startsAt,
			endsAt: request.endsAt,
			timeZone: request.timeZone,
			attendeeEmails: request.attendeeEmails as string[],
		});
		return withPrincipal(this.db, { userId, kind: "user" }, (tx) =>
			tx.meetingRequest.update({
				where: { id },
				data: {
					status: "CONFIRMED",
					confirmedAt: new Date(),
					googleEventId: event.id ?? null,
					availability,
				},
			}),
		);
	}

	list(userId: string) {
		return withPrincipal(this.db, { userId, kind: "user" }, (tx) =>
			tx.meetingRequest.findMany({ orderBy: { startsAt: "asc" }, take: 100 }),
		);
	}

	private async requireManager(tx: Prisma.TransactionClient, userId: string) {
		const member = await tx.member.findUnique({
			where: { organizationId_userId: { organizationId: "workspace", userId } },
			select: { role: true },
		});
		if (member?.role !== "admin" && member?.role !== "team")
			throw new ForbiddenException(
				"Meeting approval requires Team or Admin access.",
			);
	}
}
