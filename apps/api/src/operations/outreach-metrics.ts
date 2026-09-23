import type { Prisma } from "@crm/db";

export function coldOutreachSentWhere(
	start: Date,
): Prisma.OutboundDeliveryWhereInput {
	return {
		draft: { coldOutreach: true },
		sentAt: { gte: start },
	};
}

export function coldOutreachReplyWhere(
	start: Date,
): Prisma.OutboundDeliveryWhereInput {
	return {
		draft: { coldOutreach: true },
		status: "REPLIED",
		replyIntent: {
			in: [
				"HUMAN_POSITIVE",
				"HUMAN_NEUTRAL",
				"HUMAN_NEGATIVE",
				"REFERRAL_OR_ROUTING",
			],
		},
		updatedAt: { gte: start },
	};
}
