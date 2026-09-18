import { db } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import { purposeOf } from "./session-purpose";

const ATLAS_OPERATOR_ID = "atlas-operator";

export function atlasLocalDateKey(
	date = new Date(),
	timeZone = "Europe/Amsterdam",
): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const values = Object.fromEntries(
		parts.map((part) => [part.type, part.value]),
	);
	return `${values.year}-${values.month}-${values.day}`;
}

export function atlasReportWindow(
	date = new Date(),
	timeZone = "Europe/Amsterdam",
	reportMinute = 1140,
): boolean {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const values = Object.fromEntries(
		parts.map((part) => [part.type, part.value]),
	);
	const minute = Number(values.hour) * 60 + Number(values.minute);
	return (
		!["Sat", "Sun"].includes(values.weekday ?? "") && minute === reportMinute
	);
}

export async function writeAtlasDailyReport(
	ctx: Parameters<typeof purposeOf>[0],
) {
	if (purposeOf(ctx) !== "atlas-daily-report")
		throw new Error(
			"This tool is only available to the Atlas daily report task.",
		);
	return withPrincipal(
		db,
		{ userId: ATLAS_OPERATOR_ID, kind: "service" },
		async (tx) => {
			const settings = await tx.appSetting.findUnique({
				where: { id: "app" },
				select: { atlasWorkingTimeZone: true },
			});
			const timeZone = settings?.atlasWorkingTimeZone ?? "Europe/Amsterdam";
			const dateKey = atlasLocalDateKey(new Date(), timeZone);
			const reportDate = new Date(`${dateKey}T00:00:00.000Z`);
			const existing = await tx.atlasDailyReport.findUnique({
				where: { reportDate_timeZone: { reportDate, timeZone } },
			});
			if (existing)
				return { created: false, id: existing.id, reportDate: dateKey };

			const periodEnd = new Date();
			const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);
			const [
				emailsSent,
				replies,
				meetings,
				opportunities,
				won,
				followUpsDue,
				activeLeads,
			] = await Promise.all([
				tx.outboundDelivery.count({
					where: {
						status: { in: ["SENT", "DELIVERED", "REPLIED"] },
						createdAt: { gte: periodStart, lt: periodEnd },
						draft: { coldOutreach: true },
					},
				}),
				tx.outboundDelivery.count({
					where: {
						status: "REPLIED",
						updatedAt: { gte: periodStart, lt: periodEnd },
						draft: { coldOutreach: true },
					},
				}),
				tx.meetingRequest.count({
					where: {
						status: "CONFIRMED",
						confirmedAt: { gte: periodStart, lt: periodEnd },
					},
				}),
				tx.lead.count({
					where: {
						stage: "OPPORTUNITY",
						updatedAt: { gte: periodStart, lt: periodEnd },
					},
				}),
				tx.lead.count({
					where: {
						stage: "WON",
						updatedAt: { gte: periodStart, lt: periodEnd },
					},
				}),
				tx.followUpStep.count({
					where: { status: "PENDING", dueAt: { lte: periodEnd } },
				}),
				tx.lead.count({
					where: { stage: { notIn: ["WON", "LOST"] }, attentionState: "NONE" },
				}),
			]);
			const summary = `${emailsSent} cold emails, ${replies} replies, ${meetings} confirmed meetings, ${opportunities} opportunities, ${won} wins, and ${followUpsDue} follow-ups due.`;
			const report = await tx.atlasDailyReport.create({
				data: {
					reportDate,
					timeZone,
					periodStart,
					periodEnd,
					emailsSent,
					replies,
					meetings,
					opportunities,
					won,
					followUpsDue,
					activeLeads,
					summary,
					metrics: {
						emailsSent,
						replies,
						meetings,
						opportunities,
						won,
						followUpsDue,
						activeLeads,
					},
				},
			});
			return { created: true, id: report.id, reportDate: dateKey, summary };
		},
	);
}
