import { afterEach, describe, expect, test } from "bun:test";
import {
	ATLAS_OUTREACH_SENDER,
	resolveAtlasOutreachSender,
} from "../src/providers/atlas-sender";

const previousAddress = process.env.RESEND_OUTREACH_FROM_EMAIL;
const previousName = process.env.RESEND_OUTREACH_FROM_NAME;

afterEach(() => {
	if (previousAddress === undefined)
		delete process.env.RESEND_OUTREACH_FROM_EMAIL;
	else process.env.RESEND_OUTREACH_FROM_EMAIL = previousAddress;
	if (previousName === undefined) delete process.env.RESEND_OUTREACH_FROM_NAME;
	else process.env.RESEND_OUTREACH_FROM_NAME = previousName;
});

describe("Atlas outreach sender", () => {
	test("resolves only the approved sender identity", () => {
		process.env.RESEND_OUTREACH_FROM_EMAIL = "outreach@iblmedia.com";
		process.env.RESEND_OUTREACH_FROM_NAME = "IBL Media Team";
		expect(resolveAtlasOutreachSender()).toEqual(ATLAS_OUTREACH_SENDER);
	});

	test("rejects the system sender before a Resend transport can be called", () => {
		process.env.RESEND_OUTREACH_FROM_EMAIL = "info@iblmedia.com";
		expect(() => resolveAtlasOutreachSender()).toThrow(
			"RESEND_OUTREACH_SENDER_MISMATCH",
		);
	});

	test("rejects another address and an altered display name", () => {
		process.env.RESEND_OUTREACH_FROM_EMAIL = "other@example.test";
		expect(() => resolveAtlasOutreachSender()).toThrow(
			"RESEND_OUTREACH_SENDER_MISMATCH",
		);
		process.env.RESEND_OUTREACH_FROM_EMAIL = "outreach@iblmedia.com";
		process.env.RESEND_OUTREACH_FROM_NAME = "Atlas";
		expect(() => resolveAtlasOutreachSender()).toThrow(
			"RESEND_OUTREACH_SENDER_NAME_MISMATCH",
		);
	});
});
