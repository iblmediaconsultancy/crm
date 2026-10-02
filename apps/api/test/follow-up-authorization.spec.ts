import { describe, expect, test } from "bun:test";
import { followUpAuthorizationDisposition } from "../src/providers/follow-up-authorization";
import {
	FOLLOW_UP_CLAIM_SQL,
	FOLLOW_UP_UTC_CLOCK,
} from "../src/providers/follow-up-claim";

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
	});
});
