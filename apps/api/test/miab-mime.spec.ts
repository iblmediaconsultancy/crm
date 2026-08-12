import { describe, expect, it } from "bun:test";
import { parseMimeMessage } from "../src/providers/miab-imap.client";

const encoder = new TextEncoder();

describe("MIAB MIME parsing", () => {
	it("decodes international headers, quoted printable text, recipients, and attachments", async () => {
		const source = encoder.encode([
			"Message-ID: <fixture@example.com>",
			"Date: Tue, 11 Aug 2026 12:00:00 +0200",
			"From: =?UTF-8?Q?Jos=C3=A9_Silva?= <jose@example.com>",
			"To: Team <team@example.com>",
			"Subject: =?UTF-8?Q?Transfer_=E2=9C=93?=",
			"MIME-Version: 1.0",
			"Content-Type: multipart/mixed; boundary=fixture",
			"",
			"--fixture",
			"Content-Type: text/plain; charset=utf-8",
			"Content-Transfer-Encoding: quoted-printable",
			"",
			"Hello =E2=9C=93",
			"--fixture",
			"Content-Type: application/pdf; name=profile.pdf",
			"Content-Disposition: attachment; filename=profile.pdf",
			"Content-Transfer-Encoding: base64",
			"",
			"JVBERi0xLjQ=",
			"--fixture--",
			"",
		].join("\r\n"));
		const parsed = await parseMimeMessage(7, source);
		expect(parsed?.from).toEqual({ email: "jose@example.com", name: "José Silva" });
		expect(parsed?.subject).toBe("Transfer ✓");
		expect(parsed?.body).toContain("Hello ✓");
		expect(parsed?.attachments[0]).toMatchObject({ filename: "profile.pdf", contentType: "application/pdf", disposition: "attachment" });
	});

	it("rejects a message above the configured bound before parsing", async () => {
		await expect(parseMimeMessage(8, new Uint8Array(25 * 1024 * 1024 + 1))).rejects.toThrow("MIAB_MESSAGE_TOO_LARGE");
	});
});