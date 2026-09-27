import { connect, type TLSSocket } from "node:tls";

export class ReadOnlyImapClient {
	private socket: TLSSocket | undefined;
	private buffer = "";
	private counter = 0;

	async open(host: string, port: number) {
		this.socket = connect({
			host,
			port,
			servername: host,
			rejectUnauthorized: true,
		});
		this.socket.setEncoding("utf8");
		this.socket.on("data", (chunk) => {
			this.buffer += chunk;
		});
		await new Promise<void>((resolve, reject) => {
			this.socket?.once("secureConnect", resolve);
			this.socket?.once("error", reject);
		});
		await this.waitFor("* OK");
	}

	private async waitFor(marker: string) {
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			if (this.buffer.includes(marker)) return this.buffer;
			await Bun.sleep(25);
		}
		throw new Error(`IMAP response timeout for ${marker}`);
	}

	async command(command: string) {
		if (!this.socket) throw new Error("IMAP TLS socket is not open");
		const tag = `P${String(++this.counter).padStart(3, "0")}`;
		this.buffer = "";
		this.socket.write(`${tag} ${command}\r\n`);
		const response = await this.waitFor(`${tag} `);
		if (!response.includes(`${tag} OK`))
			throw new Error(`IMAP command failed: ${command.split(" ")[0]}`);
		return response;
	}

	async authenticate(user: string, password: string) {
		await this.command(`LOGIN ${quoteImap(user)} ${quoteImap(password)}`);
	}

	async inspectReadOnly() {
		const capabilities = await this.command("CAPABILITY");
		const folders = await this.command('LIST "" "*"');
		await this.command("EXAMINE INBOX");
		const search = await this.command("UID SEARCH ALL");
		const ids = search.match(/\* SEARCH ([0-9 ]+)/)?.[1]?.trim();
		let fetchedReadOnly = false;
		if (ids) {
			const latest = ids.split(/\s+/).at(-1);
			if (latest) {
				await this.command(
					`UID FETCH ${latest} (BODY.PEEK[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES FROM TO SUBJECT)] BODY.PEEK[TEXT]<0.2048>)`,
				);
				fetchedReadOnly = true;
			}
		}
		return {
			capability: /IMAP4/i.test(capabilities),
			inboxDiscovered: /INBOX/i.test(folders),
			messageCountObserved: ids ? ids.split(/\s+/).length : 0,
			fetchedReadOnly,
		};
	}

	async close() {
		if (!this.socket) return;
		try {
			await this.command("LOGOUT");
		} finally {
			this.socket.destroy();
		}
	}
}

export function quoteImap(value: string) {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function requireDedicatedProviderScope() {
	const scopeVariable = "PHASE0_PROVIDER_SCOPE";
	if (process.env[scopeVariable] !== "DEDICATED_NON_PRODUCTION") {
		throw new Error("PHASE0_PROVIDER_SCOPE must be DEDICATED_NON_PRODUCTION");
	}
}

export function requiredProviderEnv<const T extends readonly string[]>(
	names: T,
) {
	const values: Record<string, string> = {};
	for (const name of names) {
		const value = process.env[name];
		if (!value)
			throw new Error(`Missing dedicated provider configuration: ${name}`);
		values[name] = value;
	}
	return values as Record<T[number], string>;
}

export function parseSender(value: string) {
	const named = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(value);
	const address = named?.[2];
	if (named && address)
		return {
			displayName: named[1]?.trim() || "IBL Phase 0",
			address: address.toLowerCase(),
		};
	if (/^[^<>\s]+@[^<>\s]+$/.test(value))
		return { displayName: "IBL Phase 0", address: value.toLowerCase() };
	throw new Error(
		"PHASE0_RESEND_FROM must be an email address or Display Name <address>",
	);
}
