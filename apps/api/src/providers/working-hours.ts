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

export function businessDaysBefore(
	date: Date,
	days: number,
	timeZone = "Europe/Amsterdam",
): Date {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const value = (type: string) =>
		Number(parts.find((part) => part.type === type)?.value ?? "0");
	const cursor = new Date(
		Date.UTC(value("year"), value("month") - 1, value("day")),
	);
	let remaining = days;
	while (remaining > 0) {
		cursor.setUTCDate(cursor.getUTCDate() - 1);
		const weekday = cursor.getUTCDay();
		if (weekday !== 0 && weekday !== 6) remaining -= 1;
	}
	const wallMidnight = Date.UTC(
		cursor.getUTCFullYear(),
		cursor.getUTCMonth(),
		cursor.getUTCDate(),
	);
	let instant = wallMidnight;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const localParts = new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		}).formatToParts(new Date(instant));
		const localValue = (type: string) =>
			Number(localParts.find((part) => part.type === type)?.value ?? "0");
		const representedAsUtc = Date.UTC(
			localValue("year"),
			localValue("month") - 1,
			localValue("day"),
			localValue("hour"),
			localValue("minute"),
			localValue("second"),
		);
		instant = wallMidnight - (representedAsUtc - instant);
	}
	return new Date(instant);
}
