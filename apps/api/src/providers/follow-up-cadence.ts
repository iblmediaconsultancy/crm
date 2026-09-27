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

export function preserveLaterFollowUpDueAt(
	currentDueAt: Date,
	targetDueAt: Date,
): Date {
	return targetDueAt > currentDueAt ? targetDueAt : currentDueAt;
}
