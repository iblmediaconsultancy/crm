import { describe, expect, test } from "bun:test";
import { sanitizeAttachmentFilename } from "../src/providers/attachment-storage.service";

describe("attachment filename sanitization", () => {
	test("replaces control and path characters without preserving them", () => {
		const unsafe = `a${String.fromCharCode(0, 31, 127)}/\\:b.pdf`;

		expect(sanitizeAttachmentFilename(unsafe)).toBe("a_b.pdf");
	});

	test("normalizes Unicode, removes leading dots, and bounds the filename", () => {
		expect(sanitizeAttachmentFilename("．．report.pdf")).toBe("report.pdf");
		expect(sanitizeAttachmentFilename("x".repeat(200))).toHaveLength(180);
	});
});
