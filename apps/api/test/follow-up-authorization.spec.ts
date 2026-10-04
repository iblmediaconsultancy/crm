import { describe, expect, test } from "bun:test";
import { followUpAuthorizationDisposition } from "../src/providers/follow-up-authorization";
import { canonicalFollowUpStepDueAt } from "../src/providers/follow-up-cadence";
import {
	FOLLOW_UP_CLAIM_SQL,
	FOLLOW_UP_COHORT_CLAIM_SQL,
	FOLLOW_UP_UTC_CLOCK,
} from "../src/providers/follow-up-claim";
import { followUpClaimAllowed } from "../src/providers/outreach-execution-gates";
import { OutreachLifecycleService } from "../src/providers/outreach-lifecycle.service";
import { CLAIM_OUTBOUND } from "../src/providers/postgres-job-worker.service";
import {
	businessDaysAfter,
	businessDaysBefore,
} from "../src/providers/working-hours";

describe("follow-up authorization lifecycle", () => {
	const authorizedColdDraft = {
		manuallyApproved: false,
		coldDraft: true,
		mailboxAllowed: true,
		hasAuthorizationEvidence: true,
		authorizationValid: true,
		liveOutreachEnabled: true,
	};

	test("waits without cancelling when the previous session authorization is revoked", () => {
		expect(
			followUpAuthorizationDisposition({
				...authorizedColdDraft,
				hasAuthorizationEvidence: false,
				authorizationValid: false,
			}),
		).toBe("WAIT");
	});

	test("waits while the live-outreach gates are disabled", () => {
		expect(
			followUpAuthorizationDisposition({
				...authorizedColdDraft,
				liveOutreachEnabled: false,
			}),
		).toBe("WAIT");
	});

	test("allows the fresh current-session authorization to replace a revoked stored authorization", () => {
		expect(followUpAuthorizationDisposition(authorizedColdDraft)).toBe("READY");
	});

	test("cancels a cold draft that uses a non-authorized mailbox", () => {
		expect(
			followUpAuthorizationDisposition({
				...authorizedColdDraft,
				mailboxAllowed: false,
			}),
		).toBe("CANCEL");
	});

	test("preserves the independently approved human path", () => {
		expect(
			followUpAuthorizationDisposition({
				...authorizedColdDraft,
				manuallyApproved: true,
				liveOutreachEnabled: false,
			}),
		).toBe("READY");
	});
});

describe("follow-up due-time SQL", () => {
	test("compares due, retry, and lease timestamps using UTC wall time", () => {
		expect(FOLLOW_UP_UTC_CLOCK).toBe("(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')");
		expect(FOLLOW_UP_CLAIM_SQL.split(`<=${FOLLOW_UP_UTC_CLOCK}`)).toHaveLength(
			5,
		);
		expect(FOLLOW_UP_CLAIM_SQL).toContain(`"dueAt"<=${FOLLOW_UP_UTC_CLOCK}`);
		expect(FOLLOW_UP_CLAIM_SQL).toContain(`"retryAt"<=${FOLLOW_UP_UTC_CLOCK}`);
		expect(FOLLOW_UP_CLAIM_SQL).toContain(
			`"leasedUntil"<=${FOLLOW_UP_UTC_CLOCK}`,
		);
		expect(FOLLOW_UP_CLAIM_SQL).toContain('"atlasLiveOutreachEnabled"=true');
		expect(FOLLOW_UP_CLAIM_SQL).toContain(
			"lower(m.\"address\")='outreach@iblmedia.com'",
		);
		expect(FOLLOW_UP_CLAIM_SQL).toContain('a."id"=d."authorizationId"');
		expect(FOLLOW_UP_CLAIM_SQL).toContain("\"status\"='ACTIVE'");
		expect(FOLLOW_UP_CLAIM_SQL).toContain(`"expiresAt">${FOLLOW_UP_UTC_CLOCK}`);
		expect(FOLLOW_UP_CLAIM_SQL).toContain("\"status\"='APPROVED'");
		expect(FOLLOW_UP_CLAIM_SQL).toContain("$3::boolean");
		expect(CLAIM_OUTBOUND).toContain("$2::boolean");
		expect(CLAIM_OUTBOUND).toContain("$3::boolean");
		expect(CLAIM_OUTBOUND).toContain("$4::boolean");
		expect(CLAIM_OUTBOUND).toContain("followup-delivery:%");
		expect(CLAIM_OUTBOUND).toContain('a."followUpCohortId" IS NULL');
		expect(CLAIM_OUTBOUND).toContain("fm.\"status\" = 'QUEUED'");
		expect(CLAIM_OUTBOUND).toContain("fc.\"state\" IN ('ACTIVE', 'COMPLETED')");
	});

	test("cohort claim is restricted to exact members and canonical due timestamps", () => {
		expect(FOLLOW_UP_COHORT_CLAIM_SQL).toContain(
			'JOIN "followUpExecutionCohortMember" m',
		);
		expect(FOLLOW_UP_COHORT_CLAIM_SQL).toContain('m."cohortId"=$2::text');
		expect(FOLLOW_UP_COHORT_CLAIM_SQL).toContain("m.\"status\"='PENDING'");
		expect(FOLLOW_UP_COHORT_CLAIM_SQL).toContain(
			`m."canonicalDueAt"<=${FOLLOW_UP_UTC_CLOCK}`,
		);
		expect(FOLLOW_UP_COHORT_CLAIM_SQL).toContain(
			`s."dueAt"<=${FOLLOW_UP_UTC_CLOCK}`,
		);
		expect(FOLLOW_UP_COHORT_CLAIM_SQL).toContain('a."followUpCohortId"=c."id"');
		expect(FOLLOW_UP_COHORT_CLAIM_SQL).toContain("c.\"state\"='ACTIVE'");
		expect(FOLLOW_UP_COHORT_CLAIM_SQL).toContain(
			"FOR UPDATE OF s SKIP LOCKED LIMIT 1",
		);
		expect(FOLLOW_UP_COHORT_CLAIM_SQL).toContain(
			'"atlasLiveOutreachEnabled"=true',
		);
		expect(FOLLOW_UP_COHORT_CLAIM_SQL).toContain(
			"\"scope\"='STANDARD_COLD_OUTREACH'",
		);
		expect(FOLLOW_UP_CLAIM_SQL).toContain('a."followUpCohortId"=$4::text');
	});

	test("FU2 timing is five business days after the actual FU1 send, not the cold send", () => {
		const coldSentAt = new Date("2026-09-25T10:00:00.000Z");
		const actualFu1SentAt = new Date("2026-10-05T10:00:00.000Z");
		const fu1DueAt = canonicalFollowUpStepDueAt(0, coldSentAt);
		const fu2DueAt = canonicalFollowUpStepDueAt(1, coldSentAt, actualFu1SentAt);
		expect(fu1DueAt).toEqual(
			businessDaysAfter(coldSentAt, 5, "Europe/Amsterdam"),
		);
		expect(fu2DueAt).toEqual(
			businessDaysAfter(actualFu1SentAt, 5, "Europe/Amsterdam"),
		);
		expect(fu2DueAt).not.toEqual(
			businessDaysAfter(coldSentAt, 10, "Europe/Amsterdam"),
		);
	});

	test("FU1/FU2 canonical timing crosses weekends and DST through the shared Amsterdam helper", () => {
		const coldSentAt = new Date("2026-10-23T09:00:00.000Z");
		const fu1DueAt = canonicalFollowUpStepDueAt(0, coldSentAt);
		const actualFu1SentAt = new Date("2026-10-30T09:00:00.000Z");
		const fu2DueAt = canonicalFollowUpStepDueAt(1, coldSentAt, actualFu1SentAt);
		expect(fu1DueAt).toEqual(
			businessDaysAfter(coldSentAt, 5, "Europe/Amsterdam"),
		);
		expect(fu2DueAt).toEqual(
			businessDaysAfter(actualFu1SentAt, 5, "Europe/Amsterdam"),
		);
		expect(canonicalFollowUpStepDueAt(1, coldSentAt)).toBeNull();
	});

	test("organization-density lookback starts at Amsterdam midnight across DST", () => {
		const beforeWeekend = businessDaysBefore(
			new Date("2026-10-05T10:00:00.000Z"),
			5,
		);
		const acrossDst = businessDaysBefore(
			new Date("2026-10-30T12:00:00.000Z"),
			5,
		);
		const localParts = (date: Date) =>
			new Intl.DateTimeFormat("en-CA", {
				timeZone: "Europe/Amsterdam",
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
			}).formatToParts(date);
		const dateKey = (date: Date) => {
			const parts = localParts(date);
			return ["year", "month", "day"]
				.map((type) => parts.find((part) => part.type === type)?.value)
				.join("-");
		};
		for (const [date, expectedDate] of [
			[beforeWeekend, "2026-09-28"],
			[acrossDst, "2026-10-23"],
		] as const) {
			const parts = localParts(date);
			expect(dateKey(date)).toBe(expectedDate);
			expect(parts.find((part) => part.type === "hour")?.value).toBe("00");
			expect(parts.find((part) => part.type === "minute")?.value).toBe("00");
		}
	});
});

describe("follow-up pre-claim execution gates", () => {
	const allowedAutonomous = {
		manuallyApproved: false,
		coldDraft: true,
		mailboxAllowed: true,
		hasAuthorizationEvidence: true,
		authorizationValid: true,
		liveOutreachEnabled: true,
		scheduledExecutionEnabled: true,
		providerReady: true,
		cohortBound: true,
	};

	test("does not claim or lease when live outreach is disabled", () => {
		expect(
			followUpClaimAllowed({
				...allowedAutonomous,
				liveOutreachEnabled: false,
			}),
		).toBe(false);
	});

	test("does not claim or lease when scheduled execution is disabled", () => {
		expect(
			followUpClaimAllowed({
				...allowedAutonomous,
				scheduledExecutionEnabled: false,
			}),
		).toBe(false);
	});

	test.each([
		{ hasAuthorizationEvidence: false, authorizationValid: false },
		{ hasAuthorizationEvidence: true, authorizationValid: false },
	])("does not claim without a current authorization", (authorization) => {
		expect(
			followUpClaimAllowed({ ...allowedAutonomous, ...authorization }),
		).toBe(false);
	});

	test("does not claim when the provider is not ready", () => {
		expect(
			followUpClaimAllowed({ ...allowedAutonomous, providerReady: false }),
		).toBe(false);
	});

	test("does not authorize autonomous claims from an unbound standard authorization", () => {
		expect(
			followUpClaimAllowed({ ...allowedAutonomous, cohortBound: false }),
		).toBe(false);
	});

	test("allows the separately approved path without autonomous gates", () => {
		expect(
			followUpClaimAllowed({
				...allowedAutonomous,
				manuallyApproved: true,
				liveOutreachEnabled: false,
				scheduledExecutionEnabled: false,
			}),
		).toBe(true);
	});

	test("allows autonomous work only when all applicable gates are valid", () => {
		expect(followUpClaimAllowed(allowedAutonomous)).toBe(true);
	});

	test("does not allow an unbound standard authorization for autonomous follow-ups", () => {
		expect(
			followUpClaimAllowed({ ...allowedAutonomous, cohortBound: false }),
		).toBe(false);
	});
});

describe("cohort-bound follow-up worker scope", () => {
	test("does not fall back to the broad queue after a cohort is completed", async () => {
		const previousScheduled = process.env.ATLAS_SCHEDULED_EXECUTION_ENABLED;
		const previousLive = process.env.ATLAS_LIVE_OUTREACH_ENABLED;
		process.env.ATLAS_SCHEDULED_EXECUTION_ENABLED = "false";
		process.env.ATLAS_LIVE_OUTREACH_ENABLED = "false";
		let broadClaims = 0;
		const tx = {
			$executeRaw: async () => undefined,
			$queryRawUnsafe: async () => {
				broadClaims += 1;
				return [];
			},
			providerCapability: {
				findUnique: async () => ({ status: "VERIFIED" }),
			},
			appSetting: {
				findUnique: async () => ({ atlasLiveOutreachEnabled: true }),
			},
			followUpExecutionCohort: {
				findFirst: async (args: { where: { state: unknown } }) =>
					JSON.stringify(args.where.state).includes("COMPLETED")
						? {
								id: "completed-cohort",
								state: "COMPLETED",
								authorization: {
									id: "cohort-authorization",
									followUpCohortId: "completed-cohort",
									scope: "STANDARD_COLD_OUTREACH",
									status: "ACTIVE",
									expiresAt: null,
								},
							}
						: null,
			},
		};
		const database = {
			$transaction: async (callback: (client: typeof tx) => Promise<unknown>) =>
				callback(tx),
		} as never;
		try {
			const service = new OutreachLifecycleService(database);
			expect(await service.runDue("completed-cohort-worker")).toBe(0);
			expect(broadClaims).toBe(0);
		} finally {
			if (previousScheduled === undefined)
				delete process.env.ATLAS_SCHEDULED_EXECUTION_ENABLED;
			else process.env.ATLAS_SCHEDULED_EXECUTION_ENABLED = previousScheduled;
			if (previousLive === undefined)
				delete process.env.ATLAS_LIVE_OUTREACH_ENABLED;
			else process.env.ATLAS_LIVE_OUTREACH_ENABLED = previousLive;
		}
	});
});
