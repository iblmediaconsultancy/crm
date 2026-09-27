import { describe, expect, it } from "bun:test";
import { Prisma } from "../../../packages/db/src/generated/prisma/client";
import {
	normalizeResearchInspection,
	type ResearchInspectionInput,
} from "../agent/lib/ibl-research";

describe("IBL research inspection output", () => {
	it("normalizes database values into a JSON-safe research context", () => {
		const input: ResearchInspectionInput = {
			identity: {
				principal: {
					userId: "user-1",
					name: "Research Owner",
					role: "admin",
				},
				profile: {
					preferredLanguage: "en",
					locale: "en-GB",
					timeZone: "Europe/Amsterdam",
					workingPreferences: { researchDepth: "focused" },
				},
				mailbox: {
					mailboxId: "mailbox-1",
					address: "owner@local.test",
					displayName: "Owner",
					signature: null,
					verificationStatus: "VERIFIED",
				},
				crmTarget: { kind: "LEAD", id: "lead-1" },
			},
			request: {
				id: "request-1",
				prompt: "Find one evidence-backed outreach angle.",
				status: "RUNNING",
				targetType: "LEAD",
				targetEntityId: "lead-1",
			},
			findings: [
				{
					id: "finding-1",
					field: "outreachAngle",
					summary: "A concise introduction is appropriate.",
					value: { source: "public-url" },
					confidence: new Prisma.Decimal("0.9500"),
					status: "PROPOSED",
					evidenceSource: {
						kind: "PUBLIC_URL",
						locator: "https://local.test/evidence",
						title: "Local evidence",
						capturedAt: new Date("2026-08-21T20:32:13.619Z"),
					},
				},
			],
		};

		const output = normalizeResearchInspection(input);
		const encoded = JSON.stringify(output);

		expect(JSON.parse(encoded)).toEqual(output);
		expect(output.identity.principal.userId).toBe("user-1");
		expect(output.identity.mailbox?.mailboxId).toBe("mailbox-1");
		expect(output.identity.crmTarget?.id).toBe("lead-1");
		expect(output.request.id).toBe("request-1");
		expect(output.findings[0]?.id).toBe("finding-1");
		expect(output.findings[0]?.confidence).toBe(0.95);
		expect(output.findings[0]?.evidenceSource.capturedAt).toBe(
			"2026-08-21T20:32:13.619Z",
		);
	});
});
