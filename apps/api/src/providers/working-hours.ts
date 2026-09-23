export function businessDaysAfter(
	base: Date,
	days: number,
	timeZone = "Europe/Amsterdam",
): Date {
	let candidate = new Date(base);
	let remaining = days;
	while (remaining > 0) {
		candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
		const weekday = new Intl.DateTimeFormat("en-US", {
			timeZone,
			weekday: "short",
		}).format(candidate);
		if (weekday !== "Sat" && weekday !== "Sun") remaining -= 1;
	}
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(candidate);
	const value = (type: string) =>
		parts.find((part) => part.type === type)?.value ?? "00";
	const minutes = Number(value("hour")) * 60 + Number(value("minute"));
	if (minutes >= 9 * 60 && minutes < 18 * 60) return candidate;
	return new Date(
		`${value("year")}-${value("month")}-${value("day")}T10:00:00.000Z`,
	);
}
