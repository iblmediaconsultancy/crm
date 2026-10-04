import { describe, expect, test } from "bun:test";
import { followUpAuthorizationDisposition } from "../src/providers/follow-up-authorization";
import {
	FOLLOW_UP_CLAIM_SQL,
	FOLLOW_UP_UTC_CLOCK,
} from "../src/providers/follow-up-claim";
import { followUpClaimAllowed } from "../src/providers/outreach-execution-gates";
import { CLAIM_OUTBOUND } from "../src/providers/postgres-job-worker.service";

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
			4,
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
});
