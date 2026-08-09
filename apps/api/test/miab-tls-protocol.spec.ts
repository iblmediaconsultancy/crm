import { describe, expect, test } from "bun:test";
import type { ConnectionOptions, TLSSocket } from "node:tls";
import {
	type TlsConnector,
	TlsMiabProtocolClient,
} from "../src/providers/miab-imap.client";

class FakeTlsSocket {
	private data: ((chunk: string) => void) | null = null;
	destroyed = false;
	writes: string[] = [];

	setEncoding() {
		return this;
	}

	on(event: string, callback: (chunk: string) => void) {
		if (event === "data") this.data = callback;
		return this;
	}

	once(event: string, callback: (...args: never[]) => void) {
		if (event === "secureConnect") {
			queueMicrotask(() => {
				this.data?.("* OK synthetic MIAB ready\r\n");
				callback();
			});
		}
		return this;
	}

	write(value: string) {
		this.writes.push(value);
		const tag = value.split(" ")[0];
		if (value.includes(" CAPABILITY")) {
			this.data?.(`* CAPABILITY IMAP4rev1 UIDPLUS\r\n${tag} OK\r\n`);
		} else if (value.includes(" LIST")) {
			this.data?.(`* LIST () "/" "INBOX"\r\n${tag} OK\r\n`);
		} else if (value.includes(" UID SEARCH")) {
			this.data?.(`* SEARCH\r\n${tag} OK\r\n`);
		} else {
			this.data?.(`${tag} OK\r\n`);
		}
		return true;
	}

	destroy() {
		this.destroyed = true;
	}
}

describe("MIAB TLS protocol boundary", () => {
	test("forces certificate verification and emits read-only IMAP commands", async () => {
		let options: ConnectionOptions | undefined;
		const socket = new FakeTlsSocket();
		const connector: TlsConnector = (input) => {
			options = input;
			return socket as unknown as TLSSocket;
		};
		const client = new TlsMiabProtocolClient(connector);
		await client.connect({
			host: "imap.synthetic.test",
			port: 993,
			username: "owner@synthetic.test",
			password: "synthetic-password",
		});
		expect(options).toMatchObject({
			host: "imap.synthetic.test",
			port: 993,
			servername: "imap.synthetic.test",
			rejectUnauthorized: true,
		});
		expect(await client.capabilities()).toEqual(["IMAP4rev1", "UIDPLUS"]);
		expect(await client.folders()).toEqual(["INBOX"]);
		expect(await client.fetchReadOnly("INBOX", 10, 5)).toEqual([]);
		await client.close();
		const commands = socket.writes.map((value) =>
			value.replace(/^I\d+ /, "").trim(),
		);
		expect(commands).toEqual([
			'LOGIN "owner@synthetic.test" "synthetic-password"',
			"CAPABILITY",
			'LIST "" "*"',
			'EXAMINE "INBOX"',
			"UID SEARCH UID 11:*",
			"LOGOUT",
		]);
		expect(
			commands.some((command) =>
				/\b(?:APPEND|STORE|EXPUNGE|DELETE)\b/.test(command),
			),
		).toBe(false);
		expect(socket.destroyed).toBe(true);
	});
});
