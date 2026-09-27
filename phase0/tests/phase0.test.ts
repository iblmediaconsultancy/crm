import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { authorizeAgentCapability, capabilityManifest } from "../src/agent-permissions";
import { deriveIdentityEnvelope } from "../src/identity-envelope";
import { claimDue, completeWork } from "../src/leasing";
import { authorizeMailboxAtRepository, listMailboxes, readMailboxMessages } from "../src/mailbox-repository";
import { manualResendSend, type ImapMessage, type ImapProbe, verifyImapReadOnly } from "../src/providers";
import { migrateSynthetic, stableUuid } from "../src/synthetic-migration";
import { syntheticV1Rows } from "../fixtures/synthetic-v1";

const databaseUrl = process.env.PHASE0_DATABASE_URL;
if (!databaseUrl) throw new Error("PHASE0_DATABASE_URL must name the isolated local Phase 0 database");

const sql = new SQL(databaseUrl);

beforeAll(async () => {
	await sql`TRUNCATE phase0.agent_audit_events, phase0.duplicate_candidates, phase0.migration_id_map, phase0.email_messages, phase0.email_threads, phase0.proof_items, phase0.templates, phase0.crm_tasks, phase0.contact_logs, phase0.shared_route_policies, phase0.representations, phase0.contact_routes, phase0.crm_records, phase0.mailbox_grants, phase0.mailboxes, phase0.users, phase0.work_items CASCADE`;
	await migrateSynthetic(databaseUrl);
});

afterAll(async () => {
	await sql.close();
});

describe("owner-only mailbox privacy", () => {
	test("repository authorization ignores CRM Admin and requires ownership, grant, or worker scope", () => {
		const mailbox = { id: stableUuid("mailbox:user-1"), ownerUserId: stableUuid("user:user-1") };
		expect(authorizeMailboxAtRepository({ principal: { type: "user", userId: stableUuid("user:user-1") }, mailbox, readGrantUserIds: [] })).toBe(true);
		expect(authorizeMailboxAtRepository({ principal: { type: "user", userId: stableUuid("user:user-3") }, mailbox, readGrantUserIds: [] })).toBe(false);
		expect(authorizeMailboxAtRepository({ principal: { type: "user", userId: stableUuid("user:user-2") }, mailbox, readGrantUserIds: [stableUuid("user:user-2")] })).toBe(true);
		expect(authorizeMailboxAtRepository({ principal: { type: "worker", mailboxId: mailbox.id }, mailbox, readGrantUserIds: [] })).toBe(true);
		expect(authorizeMailboxAtRepository({ principal: { type: "worker", mailboxId: stableUuid("mailbox:user-4") }, mailbox, readGrantUserIds: [] })).toBe(false);
	});

	test("Postgres RLS prevents unrelated, Admin, and unscoped body exposure", async () => {
		const owner = await readMailboxMessages(databaseUrl, { type: "user", userId: stableUuid("user:user-1") });
		const unrelated = await readMailboxMessages(databaseUrl, { type: "user", userId: stableUuid("user:user-2") });
		const admin = await readMailboxMessages(databaseUrl, { type: "user", userId: stableUuid("user:user-3") });
		const unscoped = await readMailboxMessages(databaseUrl, { type: "unscoped" });
		expect(owner.map((item) => item.body)).toEqual(["Synthetic private message body 1", "Synthetic private message body 2"]);
		expect(unrelated.map((item) => item.body)).toEqual(["Synthetic private message body 3"]);
		expect(admin.map((item) => item.body)).toEqual(["Synthetic private message body 4"]);
		expect(unscoped).toHaveLength(0);
		expect(admin.some((item) => item.body.includes("body 1"))).toBe(false);
	});

	test("explicit delegate reads only the granted mailbox", async () => {
		await sql`INSERT INTO phase0.mailbox_grants (mailbox_id, user_id, permission) VALUES (${stableUuid("mailbox:user-1")}::uuid, ${stableUuid("user:user-2")}::uuid, 'READ') ON CONFLICT DO NOTHING`;
		const delegated = await readMailboxMessages(databaseUrl, { type: "user", userId: stableUuid("user:user-2") });
		expect(delegated.map((item) => item.body).sort()).toEqual(["Synthetic private message body 1", "Synthetic private message body 2", "Synthetic private message body 3"]);
	});

	test("worker can enumerate and read only its leased mailbox scope", async () => {
		const mailboxId = stableUuid("mailbox:user-4");
		const mailboxes = await listMailboxes(databaseUrl, { type: "worker", mailboxId });
		const messages = await readMailboxMessages(databaseUrl, { type: "worker", mailboxId });
		expect(mailboxes).toHaveLength(1);
		expect(mailboxes[0].id).toBe(mailboxId);
		expect(messages.map((item) => item.body)).toEqual(["Synthetic private message body 5", "Synthetic private message body 6"]);
	});
});

describe("authenticated AI identity", () => {
	const users = [
		{ id: "u-alice", name: "Alice", role: "MEMBER", team: "IBL", language: "en", workingPreferences: { concise: true } },
		{ id: "u-bob", name: "Bob", role: "ADMIN", team: "IBL", language: "nl", workingPreferences: { concise: false } },
	];
	const mailboxes = [
		{ id: "m-alice", ownerUserId: "u-alice", address: "alice@example.test", displayName: "Alice", signature: "Alice signature" },
		{ id: "m-bob", ownerUserId: "u-bob", address: "bob@example.test", displayName: "Bob", signature: "Bob signature" },
	];

	test("derives distinct envelopes from authenticated principals", () => {
		const alice = deriveIdentityEnvelope({ principal: users[0], selectedMailboxId: "m-alice", ownedMailboxes: mailboxes, crmTarget: { kind: "player", id: "p-1" } });
		const bob = deriveIdentityEnvelope({ principal: users[1], selectedMailboxId: "m-bob", ownedMailboxes: mailboxes, crmTarget: { kind: "agent", id: "a-1" } });
		expect(alice.principal.name).toBe("Alice");
		expect(bob.principal.name).toBe("Bob");
		expect(JSON.stringify([alice, bob])).not.toContain("Ihsan");
	});

	test("rejects mailbox mismatch and client identity tampering", () => {
		expect(() => deriveIdentityEnvelope({ principal: users[0], selectedMailboxId: "m-bob", ownedMailboxes: mailboxes, crmTarget: { kind: "player", id: "p-1" } })).toThrow("mailbox does not belong");
		expect(() => deriveIdentityEnvelope({ principal: users[0], selectedMailboxId: "m-alice", ownedMailboxes: mailboxes, crmTarget: { kind: "player", id: "p-1" }, clientIdentityOverride: { name: "Ihsan" } })).toThrow("overrides are forbidden");
	});
});

describe("durable leasing", () => {
	beforeAll(async () => {
		await sql`TRUNCATE phase0.work_items`;
		for (let index = 1; index <= 6; index += 1) {
			await sql`INSERT INTO phase0.work_items (id, kind, due_at, priority) VALUES (${stableUuid(`work:${index}`)}::uuid, ${`kind-${index}`}, now() - make_interval(mins => ${10 - index}), ${100 - index})`;
		}
	});

	test("two concurrent workers claim disjoint ordered batches with SKIP LOCKED", async () => {
		const workerOne = new SQL(databaseUrl);
		const workerTwo = new SQL(databaseUrl);
		try {
			const [one, two] = await Promise.all([claimDue(workerOne, "worker-one", 3, 60), claimDue(workerTwo, "worker-two", 3, 60)]);
			const oneIds = new Set(one.map((item) => item.id));
			expect(one).toHaveLength(3);
			expect(two).toHaveLength(3);
			expect(two.every((item) => !oneIds.has(item.id))).toBe(true);
			expect([...one, ...two].map((item) => item.attempts).every((attempts) => attempts === 1)).toBe(true);
			expect(one.map((item) => item.priority)).toEqual([...one].map((item) => item.priority).sort((a, b) => b - a));
		} finally {
			await Promise.all([workerOne.close(), workerTwo.close()]);
		}
	});

	test("expired leases recover, retries count, and completion is idempotent", async () => {
		const id = stableUuid("work:1");
		await sql`UPDATE phase0.work_items SET leased_until = now() - interval '1 second', lease_owner = 'expired-worker' WHERE id = ${id}::uuid`;
		const recovered = await claimDue(sql, "recovery-worker", 1, 60);
		expect(recovered[0].id).toBe(id);
		expect(recovered[0].attempts).toBe(2);
		expect(await completeWork(sql, id, "recovery-worker")).toHaveLength(1);
		expect(await completeWork(sql, id, "recovery-worker")).toHaveLength(0);
	});
});

describe("provider paths", () => {
	test("IMAP double proves TLS/auth/capabilities/folder/read-only fetch and threading normalization", async () => {
		const calls: string[] = [];
		const message: ImapMessage = { messageId: "<reply@example.test>", inReplyTo: "<root@example.test>", from: "Sender@Example.Test", to: ["Mailbox@Example.Test"], subject: " Test ", body: "provider-double-body" };
		const client: ImapProbe = {
			async connectTls() { calls.push("tls"); },
			async authenticate() { calls.push("authenticate"); },
			async capabilities() { calls.push("capability"); return ["IMAP4rev1", "IDLE"]; },
			async folders() { calls.push("list"); return ["INBOX", "Sent"]; },
			async fetchReadOnly(folder) { calls.push(`examine:${folder}:body.peek`); return [message]; },
			async close() { calls.push("close"); },
		};
		const result = await verifyImapReadOnly(client);
		expect(calls).toEqual(["tls", "authenticate", "capability", "list", "examine:INBOX:body.peek", "close"]);
		expect(result.messages[0].threadKey).toBe("<root@example.test>");
	});

	test("manual Resend double derives From server-side and requires idempotency", async () => {
		const fetcher = mock(async (_url: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body));
			expect(body.from).toBe("Alice <alice@example.test>");
			expect(new Headers(init?.headers).get("idempotency-key")).toBe("phase0-one-send");
			return new Response(JSON.stringify({ id: "resend-test-id" }), { status: 200 });
		});
		const result = await manualResendSend({ manualApproval: true, apiKey: "dedicated-test-key", mailbox: { ownerUserId: "alice", address: "alice@example.test", displayName: "Alice" }, authenticatedUserId: "alice", to: "phase0-mailbox@example.test", subject: "Phase 0", text: "Synthetic test", idempotencyKey: "phase0-one-send", fetcher });
		expect(result.providerMessageId).toBe("resend-test-id");
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	test("manual Resend path rejects automation and mailbox mismatch", async () => {
		const base = { apiKey: "test", mailbox: { ownerUserId: "alice", address: "alice@example.test", displayName: "Alice" }, authenticatedUserId: "alice", to: "mailbox@example.test", subject: "Phase 0", text: "Synthetic", idempotencyKey: "key" };
		await expect(manualResendSend({ ...base, manualApproval: false })).rejects.toThrow("manual approval required");
		await expect(manualResendSend({ ...base, manualApproval: true, authenticatedUserId: "mallory" })).rejects.toThrow("sender mailbox mismatch");
	});
});

describe("agent capability denial", () => {
	test("manifest is default-deny, deny-all, and removes generic execution/delegation", () => {
		const manifest = capabilityManifest();
		expect(manifest.defaultPolicy).toBe("deny");
		expect(manifest.networkPolicy).toBe("deny-all");
		expect(manifest.disabledBuiltins).toEqual(expect.arrayContaining(["agent", "Workflow", "bash", "shell", "generic_runner"]));
		expect(manifest.allowedTools.some((name) => /send|resend|smtp|outbound/i.test(name))).toBe(false);
	});

	test("outbound attempt fails closed and creates an audit event", async () => {
		const result = await authorizeAgentCapability(databaseUrl, "phase0-agent", "resend.send");
		expect(result.allowed).toBe(false);
		const events = await sql<Array<{ outcome: string; requested_capability: string }>>`SELECT outcome, requested_capability FROM phase0.agent_audit_events WHERE principal_id = 'phase0-agent'`;
		expect(events).toEqual([{ outcome: "DENIED", requested_capability: "resend.send" }]);
	});

	test("installed agent authored package has no outbound mail implementation", async () => {
		const matches: string[] = [];
		const glob = new Bun.Glob("apps/agent/agent/**/*.{ts,tsx,js,mjs,cjs}");
		for await (const path of glob.scan({ cwd: process.cwd(), absolute: true })) {
			const content = await Bun.file(path).text();
			if (/from\s+["']resend["']|emails\.send\s*\(|sendMail\s*\(|smtp:\/\/|api\.resend\.com/i.test(content)) matches.push(path);
		}
		expect(matches).toEqual([]);
	});
});

describe("synthetic migration", () => {
	test("fixture has exactly the approved 100-record composition", () => {
		const counts = Object.groupBy(syntheticV1Rows, (item) => item.type);
		expect(syntheticV1Rows).toHaveLength(100);
		expect(Object.fromEntries(Object.entries(counts).map(([type, items]) => [type, items?.length]))).toEqual({ user: 4, agency: 4, agent: 6, player: 12, lead: 15, contact_route: 16, representation: 10, shared_route_policy: 4, contact_log: 8, task: 5, template: 3, proof_item: 3, email_thread: 4, email_message: 6 });
	});

	test("all source rows map, duplicates surface, ownership links hold, and rerun is idempotent", async () => {
		const first = await migrateSynthetic(databaseUrl);
		const second = await migrateSynthetic(databaseUrl);
		expect(first).toEqual({ sourceCount: 100, mappingCount: 100, duplicateCount: 3, rejectedCount: 0 });
		expect(second).toEqual(first);
		const [orphans] = await sql<Array<{ count: number }>>`
			SELECT (
				(SELECT count(*) FROM phase0.contact_routes r LEFT JOIN phase0.users u ON u.id = r.owner_user_id LEFT JOIN phase0.crm_records c ON c.id = r.record_id WHERE u.id IS NULL OR c.id IS NULL) +
				(SELECT count(*) FROM phase0.representations r LEFT JOIN phase0.crm_records a ON a.id = r.agent_id LEFT JOIN phase0.crm_records p ON p.id = r.player_id WHERE a.id IS NULL OR p.id IS NULL) +
				(SELECT count(*) FROM phase0.email_messages m LEFT JOIN phase0.email_threads t ON t.id = m.thread_id WHERE t.id IS NULL)
			)::int AS count
		`;
		expect(orphans.count).toBe(0);
		const [ownership] = await sql<Array<{ count: number }>>`SELECT count(*)::int AS count FROM phase0.email_threads t JOIN phase0.mailboxes m ON m.id = t.mailbox_id JOIN phase0.users u ON u.id = m.owner_user_id`;
		expect(ownership.count).toBe(4);
		expect(JSON.stringify(first)).not.toContain("Synthetic private message body");
		expect(JSON.stringify(first)).not.toMatch(/password|credential|api.?key/i);
	});
});
