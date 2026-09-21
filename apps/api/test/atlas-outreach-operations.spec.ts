import { describe, expect, test } from "bun:test";
import { buildRfc822Message, selectSentFolder } from "../src/providers/miab-sent-sync.service";
import { businessDaysAfter } from "../src/providers/outreach-lifecycle.service";

describe("Atlas outbound operations", () => {
	test("selects the canonical Sent folder without depending on folder order", () => {
		expect(selectSentFolder(["INBOX", "Archive", "Sent", "Trash"])).toBe("Sent");
		expect(selectSentFolder(["INBOX", "Sent Items", "Spam"])).toBe("Sent Items");
		expect(selectSentFolder(["INBOX", "Archive"])).toBeNull();
	});

	test("builds a stable RFC822 Sent copy with provider metadata", () => {
		const input = {
			messageId: "<ibl-draft@example.test>",
			deliveryId: "delivery-1",
			providerMessageId: "provider-1",
			fromEmail: "outreach@iblmedia.com",
			fromName: "IBL Media Team",
			toEmail: "person@example.test",
			subject: "A current football opportunity",
			body: "Hello\n\nA specific note.",
			sentAt: new Date("2026-09-21T13:00:00.000Z"),
		};
		const first = new TextDecoder().decode(buildRfc822Message(input));
		const second = new TextDecoder().decode(buildRfc822Message(input));
		expect(first).toBe(second);
		expect(first).toContain("Message-ID: <ibl-draft@example.test>");
		expect(first).toContain("X-IBL-CRM-Delivery-ID: delivery-1");
		expect(first).toContain("X-IBL-Resend-Message-ID: provider-1");
		expect(first).toContain("Hello\r\n\r\nA specific note.");
	});

	test("schedules follow-ups on business days inside the working window", () => {
		const friday = new Date("2026-09-25T13:00:00.000Z");
		const monday = businessDaysAfter(friday, 1, "Europe/Amsterdam");
		expect(monday.toISOString()).toBe("2026-09-28T13:00:00.000Z");
	});
});
