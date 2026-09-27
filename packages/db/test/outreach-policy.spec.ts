import { describe, expect, it } from "bun:test";
import {
	coldOutreachBlockReason,
	isGlobalSuppression,
	isHistoricalLinkedInMessage,
	shouldCancelFollowUp,
} from "../src/outreach-policy";
import { manualPersonProtectionActorAllowed } from "../src/person-protection";

const eligible = {
	contactOutreachState: "ALLOWED" as const,
	leadAttentionState: "NONE" as const,
	channelStatus: "COLD_ELIGIBLE" as const,
	otherChannelStatus: null,
	routeSuppressed: false,
	contactSuppressed: false,
	organizationSuppressed: false,
	firstTouchStatus: null,
};

describe("shared outreach policy", () => {
	it("blocks cold email when LinkedIn is an active human conversation", () => {
		expect(
			coldOutreachBlockReason({
				...eligible,
				otherChannelStatus: "ACTIVE_HUMAN_CONVERSATION",
			}),
		).toBe("OTHER_CHANNEL_ACTIVE_HUMAN_CONVERSATION");
	});

	it("blocks cold LinkedIn when email has an active human conversation", () => {
		expect(
			coldOutreachBlockReason({
				...eligible,
				otherChannelStatus: "ACTIVE_HUMAN_CONVERSATION",
			}),
		).toBe("OTHER_CHANNEL_ACTIVE_HUMAN_CONVERSATION");
	});

	it("keeps route suppression narrower than contact suppression", () => {
		expect(
			coldOutreachBlockReason({ ...eligible, routeSuppressed: true }),
		).toBe("CHANNEL_ROUTE_SUPPRESSED");
		expect(isGlobalSuppression("ROUTE")).toBe(false);
		expect(isGlobalSuppression("CONTACT")).toBe(true);
		expect(isGlobalSuppression("ORGANIZATION")).toBe(true);
	});

	it("cancels follow-ups only in the channel that received the reply", () => {
		expect(shouldCancelFollowUp("EMAIL", "EMAIL")).toBe(true);
		expect(shouldCancelFollowUp("LINKEDIN", "EMAIL")).toBe(false);
	});

	it("enforces a shared cold first-touch claim", () => {
		expect(
			coldOutreachBlockReason({ ...eligible, firstTouchStatus: "CLAIMED" }),
		).toBe("FIRST_TOUCH_CLAIMED");
		expect(
			coldOutreachBlockReason({ ...eligible, firstTouchStatus: "CONSUMED" }),
		).toBe("FIRST_TOUCH_CONSUMED");
	});

	it("keeps not-now parking eligible without converting it to suppression", () => {
		expect(
			coldOutreachBlockReason({ ...eligible, channelStatus: "PARKED" }),
		).toBeNull();
	});

	it("treats organization and contact suppression as cross-channel", () => {
		expect(
			coldOutreachBlockReason({ ...eligible, contactSuppressed: true }),
		).toBe("CONTACT_SUPPRESSED");
		expect(
			coldOutreachBlockReason({ ...eligible, organizationSuppressed: true }),
		).toBe("ORGANIZATION_SUPPRESSED");
	});

	it("keeps manual organization protection ahead of normal eligibility", () => {
		expect(
			coldOutreachBlockReason({ ...eligible, organizationProtected: true }),
		).toBe("ORGANIZATION_OWNER_PROTECTED");
	});

	it("keeps person protection ahead of every autonomous cold-outreach route", () => {
		expect(
			coldOutreachBlockReason({
				...eligible,
				personProtected: true,
				firstTouchStatus: "CLAIMED",
			}),
		).toBe("PERSON_OWNER_PROTECTED");
		expect(
			coldOutreachBlockReason({ ...eligible, personProtected: false }),
		).toBeNull();
	});

	it("allows only human managers to activate or release person protection", () => {
		expect(
			manualPersonProtectionActorAllowed({ role: "admin", kind: "HUMAN" }),
		).toBe(true);
		expect(
			manualPersonProtectionActorAllowed({ role: "team", kind: "HUMAN" }),
		).toBe(true);
		expect(
			manualPersonProtectionActorAllowed({
				role: "admin",
				kind: "SYSTEM_OPERATOR",
			}),
		).toBe(false);
		expect(
			manualPersonProtectionActorAllowed({
				role: "contributor",
				kind: "HUMAN",
			}),
		).toBe(false);
	});

	it("excludes historical LinkedIn messages from live Atlas metrics", () => {
		expect(isHistoricalLinkedInMessage(false)).toBe(true);
		expect(isHistoricalLinkedInMessage(true)).toBe(false);
	});
});
