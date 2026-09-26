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
});
