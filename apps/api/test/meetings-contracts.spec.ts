import { describe, expect, it } from "bun:test";
import { meetingRequestInput } from "../src/meetings/meetings.contracts";

describe("meeting request contract", () => {
	it("requires a lead or contact", () => {
		const result = meetingRequestInput.safeParse({
			title: "Intro call",
			startsAt: "2026-09-21T10:00:00+02:00",
			endsAt: "2026-09-21T10:30:00+02:00",
		});
		expect(result.success).toBe(false);
	});

	it("accepts a lead and attendee list", () => {
		const result = meetingRequestInput.safeParse({
			leadId: "lead-1",
			title: "Intro call",
			startsAt: "2026-09-21T10:00:00+02:00",
			endsAt: "2026-09-21T10:30:00+02:00",
			attendeeEmails: ["Prospect@Example.com"],
		});
		expect(result.success).toBe(true);
		if (result.success)
			expect(result.data.attendeeEmails).toEqual(["prospect@example.com"]);
	});
});
