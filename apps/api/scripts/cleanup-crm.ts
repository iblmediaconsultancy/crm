import { writeFile } from "node:fs/promises";
import { db, Prisma } from "@crm/db";
import {
	decryptGoogleCalendarToken,
	encryptGoogleCalendarToken,
} from "../src/meetings/google-calendar-token";

const DATABASE_URL = process.env.DATABASE_URL;
const ATLAS_OPERATOR_ID = "atlas-operator";
const REVIEW_ADMIN_ID = "review-admin-local";
const SEED_USER_IDS = [
	"seed-ada-okafor",
	"seed-marcus-lindqvist",
	"seed-priya-raman",
] as const;
const GOOGLE_PROVIDER_ID = "google-calendar";
const DUMMY_MEETING_TITLE = "ATLAS Calendar Integration Dummy Test";
const SEED_COMPANY_NAMES = [
	"Monzo",
	"Deel",
	"Notion",
	"Pennylane",
	"Ramp",
	"Attio",
	"Mercury",
	"Stripe",
	"Personio",
	"Wise",
	"Vercel",
	"Linear",
	"Retool",
	"Cal.com",
	"Supabase",
] as const;
const REASON = "CRM cleanup: audited synthetic or acceptance-test data";

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
}

async function googleAccessToken(account: {
	accessToken: string | null;
	refreshToken: string | null;
	accessTokenExpiresAt: Date | null;
}) {
	const secret = requiredEnv("BETTER_AUTH_SECRET");
	if (
		account.accessToken &&
		account.accessTokenExpiresAt &&
		account.accessTokenExpiresAt.getTime() > Date.now() + 60_000
	)
		return decryptGoogleCalendarToken(account.accessToken, secret);
	if (!account.refreshToken) throw new Error("Google refresh token is missing");
	const clientId = requiredEnv("GOOGLE_CALENDAR_CLIENT_ID");
	const clientSecret = requiredEnv("GOOGLE_CALENDAR_CLIENT_SECRET");
	const response = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: decryptGoogleCalendarToken(account.refreshToken, secret),
			grant_type: "refresh_token",
		}),
	});
	if (!response.ok) throw new Error(`Google token refresh failed: ${response.status}`);
	const data = (await response.json()) as {
		access_token?: string;
		expires_in?: number;
	};
	if (!data.access_token) throw new Error("Google token refresh returned no access token");
	await db.account.updateMany({
		where: { userId: ATLAS_OPERATOR_ID, providerId: GOOGLE_PROVIDER_ID },
		data: {
			accessToken: encryptGoogleCalendarToken(data.access_token, secret),
			accessTokenExpiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
		},
	});
	return data.access_token;
}

async function removeDummyGoogleEvent() {
	const request = await db.meetingRequest.findFirst({
		where: { title: DUMMY_MEETING_TITLE },
		select: { id: true, title: true, googleEventId: true, calendarId: true },
	});
	if (!request) return { status: "not_found" as const };
	if (!request.googleEventId) return { status: "no_google_event_id" as const, request };
	const account = await db.account.findFirst({
		where: { userId: ATLAS_OPERATOR_ID, providerId: GOOGLE_PROVIDER_ID },
		select: { accessToken: true, refreshToken: true, accessTokenExpiresAt: true },
	});
	if (!account) throw new Error("Google Calendar account is not connected for Atlas");
	const accessToken = await googleAccessToken(account);
	const calendarId = request.calendarId || process.env.GOOGLE_CALENDAR_PRIMARY_ID || "primary";
	const response = await fetch(
		`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(request.googleEventId)}`,
		{ method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } },
	);
	if (!response.ok && response.status !== 404 && response.status !== 410)
		throw new Error(`Google dummy event deletion failed: ${response.status}`);
	return {
		status:
			response.status === 404 || response.status === 410
				? ("already_removed" as const)
				: ("removed" as const),
		request,
	};
}

async function counts() {
	const rows = await Promise.all([
		db.company.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
		db.contact.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
		db.deal.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
		db.activity.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
		db.contactRoute.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
		db.clientFinancialProfile.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
		db.financialEvent.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
		db.financialSnapshot.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
		db.companyFinancialSnapshot.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
		db.meetingRequest.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
		db.agentTask.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
		db.agentEvent.groupBy({ by: ["lifecycleState"], _count: { _all: true } }),
		db.userProfile.groupBy({ by: ["status"], _count: { _all: true } }),
		db.session.count({}),
	]);
	const names = [
		"companies",
		"contacts",
		"deals",
		"activities",
		"routes",
		"financialProfiles",
		"financialEvents",
		"financialSnapshots",
		"companyFinancialSnapshots",
		"meetingRequests",
		"agentTasks",
		"agentEvents",
		"userProfiles",
	] as const;
	return Object.fromEntries([
		...rows.slice(0, 13).map((row, index) => [names[index], row]),
		["sessions", rows[13]],
	]);
}

async function main() {
	if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
	if (!process.env.ATLAS_LIVE_OUTREACH_ENABLED || process.env.ATLAS_LIVE_OUTREACH_ENABLED === "true")
		throw new Error("ATLAS_LIVE_OUTREACH_ENABLED must be explicitly false");
	const before = await counts();
	const googleDeletion = await removeDummyGoogleEvent();
	const archive = await db.$transaction(async (tx) => {
		const seedCompanies = await tx.company.findMany({
			where: { name: { in: [...SEED_COMPANY_NAMES] }, lifecycleState: "ACTIVE" },
			select: { id: true },
		});
		const seedCompanyIds = seedCompanies.map((row) => row.id);
		const seedContacts = await tx.contact.findMany({
			where: { companyId: { in: seedCompanyIds }, lifecycleState: "ACTIVE" },
			select: { id: true },
		});
		const seedDeals = await tx.deal.findMany({
			where: { id: { startsWith: "seed-deal-" }, lifecycleState: "ACTIVE" },
			select: { id: true },
		});
		const seedActivities = await tx.activity.findMany({
			where: { id: { startsWith: "cmt8tf" }, lifecycleState: "ACTIVE" },
			select: { id: true },
		});
		const seedRoutes = await tx.contactRoute.findMany({
			where: { sourceKey: { startsWith: "atlas-v1:" }, lifecycleState: "ACTIVE" },
			select: { id: true },
		});
		const dummyDeal = await tx.deal.findFirst({
			where: { name: "sadsad", lifecycleState: "ACTIVE" },
			select: { id: true },
		});
		const dummyActivities = dummyDeal
			? await tx.activity.findMany({
					where: { dealId: dummyDeal.id, type: "STAGE_CHANGE", lifecycleState: "ACTIVE" },
					select: { id: true },
				})
			: [];
		const dummyProfile = dummyDeal
			? await tx.clientFinancialProfile.findFirst({
					where: { dealId: dummyDeal.id, lifecycleState: "ACTIVE" },
					select: { id: true },
				})
			: null;
		const orphanProfiles = await tx.clientFinancialProfile.findMany({
			where: {
				companyId: null,
				contactId: null,
				dealId: null,
				lifecycleState: "ACTIVE",
			},
			select: { id: true },
		});
		const financialProfileIds = [
			...orphanProfiles.map((row) => row.id),
			...(dummyProfile ? [dummyProfile.id] : []),
		];
		const dummyMeetings = await tx.meetingRequest.findMany({
			where: {
				title: { in: [DUMMY_MEETING_TITLE, "ATLAS Approval Gate Dummy Test"] },
				lifecycleState: "ACTIVE",
			},
			select: { id: true },
		});
		const agentTasks = await tx.agentTask.findMany({
			where: {
				lifecycleState: "ACTIVE",
				OR: [
					{ kind: "workspace-profile", reason: { contains: "ibl.example.test" } },
					{ sessionId: { startsWith: "wrun_" } },
				],
			},
			select: { id: true, sessionId: true },
		});
		const agentSessionIds = agentTasks
			.map((row) => row.sessionId)
			.filter((value): value is string => Boolean(value));
		const now = new Date();
		const update = {
			lifecycleState: "ARCHIVED" as const,
			archivedAt: now,
			archivedByUserId: ATLAS_OPERATOR_ID,
			archiveReason: REASON,
		};
		const companies = await tx.company.updateMany({ where: { id: { in: seedCompanyIds } }, data: update });
		const contacts = await tx.contact.updateMany({ where: { id: { in: seedContacts.map((row) => row.id) } }, data: update });
		const deals = await tx.deal.updateMany({ where: { id: { in: seedDeals.map((row) => row.id) } }, data: update });
		const activities = await tx.activity.updateMany({ where: { id: { in: seedActivities.map((row) => row.id) } }, data: update });
		const routes = await tx.contactRoute.updateMany({ where: { id: { in: seedRoutes.map((row) => row.id) } }, data: { lifecycleState: "ARCHIVED" } });
		const dummyDealUpdate = dummyDeal
			? await tx.deal.update({ where: { id: dummyDeal.id }, data: update })
			: null;
		const dummyActivityUpdate = await tx.activity.updateMany({ where: { id: { in: dummyActivities.map((row) => row.id) } }, data: update });
		const meetings = await tx.meetingRequest.updateMany({ where: { id: { in: dummyMeetings.map((row) => row.id) } }, data: { lifecycleState: "ARCHIVED" } });
		const profiles = await tx.clientFinancialProfile.updateMany({ where: { id: { in: financialProfileIds } }, data: { lifecycleState: "ARCHIVED" } });
		const financialEvents = await tx.financialEvent.count({ where: { financialProfileId: { in: financialProfileIds } } });
		const financialSnapshots = await tx.financialSnapshot.updateMany({ where: { financialProfileId: { in: financialProfileIds } }, data: { lifecycleState: "ARCHIVED" } });
		const oldCompanySnapshots = await tx.companyFinancialSnapshot.findMany({
			where: { lifecycleState: "ACTIVE" },
			select: { id: true, currency: true, periodStart: true, data: true },
		});
		const snapshotsToArchive = oldCompanySnapshots.filter(
			(row) => !JSON.stringify(row.data ?? {}).includes("crm-cleanup-recalculation"),
		);
		await tx.companyFinancialSnapshot.updateMany({
			where: { id: { in: snapshotsToArchive.map((row) => row.id) } },
			data: { lifecycleState: "ARCHIVED" },
		});
		const currencies = new Map<string, Date>();
		for (const row of oldCompanySnapshots) {
			const current = currencies.get(row.currency);
			if (!current || row.periodStart > current) currencies.set(row.currency, row.periodStart);
		}
		const cleanCurrencies = new Set(
			oldCompanySnapshots
				.filter((row) => JSON.stringify(row.data ?? {}).includes("crm-cleanup-recalculation"))
				.map((row) => row.currency),
		);
		for (const [currency, periodStart] of currencies) {
			if (cleanCurrencies.has(currency)) continue;
			await tx.companyFinancialSnapshot.create({
				data: {
					currency,
					periodStart,
					lifecycleState: "ACTIVE",
					recurringRevenueBase: new Prisma.Decimal(0),
					oneOffRevenueBase: new Prisma.Decimal(0),
					revenueBase: new Prisma.Decimal(0),
					directClientCostBase: new Prisma.Decimal(0),
					commissionBase: new Prisma.Decimal(0),
					operatingCostBase: new Prisma.Decimal(0),
					estimatedProfitBase: new Prisma.Decimal(0),
					margin: null,
					outstandingBase: new Prisma.Decimal(0),
					newMrrBase: null,
					lostMrrBase: null,
					activeClients: 0,
					data: { capturedAt: now.toISOString(), source: "crm-cleanup-recalculation" },
				},
			});
		}
		const suspended = await tx.userProfile.updateMany({ where: { userId: REVIEW_ADMIN_ID, status: "ACTIVE" }, data: { status: "SUSPENDED", suspendedAt: now } });
		const seedProfilesSuspended = await tx.userProfile.updateMany({ where: { userId: { in: [...SEED_USER_IDS] }, status: "ACTIVE" }, data: { status: "SUSPENDED", suspendedAt: now } });
		const sessions = await tx.session.deleteMany({ where: { userId: REVIEW_ADMIN_ID } });
		const archivedAgentTasks = await tx.agentTask.updateMany({
			where: { id: { in: agentTasks.map((row) => row.id) } },
			data: { lifecycleState: "ARCHIVED", finishedAt: now, outcome: "QUARANTINED: old development task" },
		});
		const archivedAgentEvents = await tx.agentEvent.updateMany({
			where: { sessionId: { in: agentSessionIds } },
			data: { lifecycleState: "ARCHIVED" },
		});
		return {
			seedCompanies: companies.count,
			seedContacts: contacts.count,
			seedDeals: deals.count,
			seedActivities: activities.count,
			seedRoutes: routes.count,
			dummyDeal: dummyDealUpdate ? 1 : 0,
			dummyStageActivities: dummyActivityUpdate.count,
			dummyMeetings: meetings.count,
			financeProfiles: profiles.count,
			financialEvents,
			financialSnapshots: financialSnapshots.count,
			companySnapshotsArchived: snapshotsToArchive.length,
			companySnapshotsRecalculated: currencies.size,
			reviewAdminSuspended: suspended.count,
			seedUserProfilesSuspended: seedProfilesSuspended.count,
			reviewAdminSessionsRemoved: sessions.count,
			agentTasks: archivedAgentTasks.count,
			agentEvents: archivedAgentEvents.count,
		};
	});
	const after = await counts();
	const report = {
		completedAt: new Date().toISOString(),
		googleDeletion,
		archive,
		before,
		after,
		atlasLiveOutreachEnabled: process.env.ATLAS_LIVE_OUTREACH_ENABLED,
	};
	const reportPath = process.env.CRM_CLEANUP_REPORT_PATH;
	if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
}

await main().finally(() => db.$disconnect());
