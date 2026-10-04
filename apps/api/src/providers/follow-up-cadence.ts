import { businessDaysAfter } from "./working-hours";

export const STANDARD_COLD_FOLLOW_UP_BUSINESS_DAYS = [5, 10] as const;

export function standardColdFollowUpDueDates(
	sentAt: Date,
	timeZone = "Europe/Amsterdam",
): [Date, Date] {
	return STANDARD_COLD_FOLLOW_UP_BUSINESS_DAYS.map((days) =>
		businessDaysAfter(sentAt, days, timeZone),
	) as [Date, Date];
}

export function canonicalFollowUpStepDueAt(
	position: number,
	coldEmailSentAt: Date,
	previousFollowUpSentAt?: Date | null,
	timeZone = "Europe/Amsterdam",
): Date | null {
	if (position === 0) return businessDaysAfter(coldEmailSentAt, 5, timeZone);
	if (position === 1 && previousFollowUpSentAt)
		return businessDaysAfter(previousFollowUpSentAt, 5, timeZone);
	return null;
}

export function preserveLaterFollowUpDueAt(
	currentDueAt: Date,
	targetDueAt: Date,
): Date {
	return targetDueAt > currentDueAt ? targetDueAt : currentDueAt;
}
