import { describe, expect, it } from "bun:test";
import {
	canReuseConsumedLinkedInConnectionClaim,
	hasSubstantiveLinkedInConnectionNote,
} from "../src/linkedin/linkedin-first-touch";

const noNoteRequest = {
	action: "CONNECTION_REQUEST",
	status: "SUCCEEDED",
	actionPayload: { noNote: true, note: null },
};

function reusableEvidence(
	overrides: Partial<
		Parameters<typeof canReuseConsumedLinkedInConnectionClaim>[0]
	> = {},
) {
	return {
		claimChannel: "LINKEDIN",
		claimStatus: "CONSUMED",
		claimIdempotencyKey: "claim-key",
		connectionRequest: noNoteRequest,
		messageJobExists: false,
		...overrides,
	};
}

describe("LinkedIn first-touch claim lineage", () => {
	it("allows one first message after a successful no-note request", () => {
		expect(canReuseConsumedLinkedInConnectionClaim(reusableEvidence())).toBe(
			true,
		);
	});

	it("requires an explicit no-note connection request", () => {
		expect(
			hasSubstantiveLinkedInConnectionNote({ noNote: true, note: null }),
		).toBe(false);
		expect(
			hasSubstantiveLinkedInConnectionNote({ noNote: true, note: " Hello " }),
		).toBe(true);
		expect(hasSubstantiveLinkedInConnectionNote({ note: null })).toBe(true);
		expect(
			canReuseConsumedLinkedInConnectionClaim(
				reusableEvidence({
					connectionRequest: {
						...noNoteRequest,
						actionPayload: { noNote: true, note: "Personalized note" },
					},
				}),
			),
		).toBe(false);
	});

	it("keeps actual messages and cross-channel claims blocking", () => {
		expect(
			canReuseConsumedLinkedInConnectionClaim(
				reusableEvidence({ messageJobExists: true }),
			),
		).toBe(false);
		expect(
			canReuseConsumedLinkedInConnectionClaim(
				reusableEvidence({ claimChannel: "EMAIL" }),
			),
		).toBe(false);
		expect(
			canReuseConsumedLinkedInConnectionClaim(
				reusableEvidence({
					connectionRequest: { ...noNoteRequest, status: "FAILED" },
				}),
			),
		).toBe(false);
	});

	it("allows a confirmed historical no-note request activity when the job row is absent", () => {
		expect(
			canReuseConsumedLinkedInConnectionClaim({
				claimChannel: "LINKEDIN",
				claimStatus: "CONSUMED",
				claimIdempotencyKey: "claim-key",
				connectionRequest: null,
				messageJobExists: false,
				historicalConnectionRequestActivities: [
					{
						subject: "LinkedIn connection request sent",
						body: "Pilot 002 connection request sent without a note",
						meta: {
							channel: "LINKEDIN",
							action: "CONNECTION_REQUEST",
							status: "BROWSER_CONFIRMED_PENDING",
							idempotencyKey: "claim-key",
						},
					},
				],
			}),
		).toBe(true);
	});

	it("does not reuse unrelated or substantive historical activity", () => {
		const base = {
			claimChannel: "LINKEDIN",
			claimStatus: "CONSUMED",
			claimIdempotencyKey: "claim-key",
			connectionRequest: null,
			messageJobExists: false,
		};
		expect(
			canReuseConsumedLinkedInConnectionClaim({
				...base,
				historicalConnectionRequestActivities: [
					{
						subject: "LinkedIn connection request sent",
						body: "Pilot 002 connection request sent without a note",
						meta: {
							channel: "LINKEDIN",
							action: "CONNECTION_REQUEST",
							status: "BROWSER_CONFIRMED_PENDING",
							idempotencyKey: "other-key",
						},
					},
				],
			}),
		).toBe(false);
		expect(
			canReuseConsumedLinkedInConnectionClaim({
				...base,
				historicalConnectionRequestActivities: [
					{
						subject: "LinkedIn connection request sent",
						body: "Pilot 002 connection request sent with a note",
						meta: {
							channel: "LINKEDIN",
							action: "CONNECTION_REQUEST",
							status: "BROWSER_CONFIRMED_PENDING",
							idempotencyKey: "claim-key",
						},
					},
				],
			}),
		).toBe(false);
	});
});
