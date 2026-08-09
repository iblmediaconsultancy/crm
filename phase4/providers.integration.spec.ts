import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
	MiabFetchedMessage,
	MiabProtocolClient,
} from "../apps/api/src/providers/miab-imap.client";
import { MiabSyncService } from "../apps/api/src/providers/miab-sync.service";
import { OutboundDeliveryService } from "../apps/api/src/providers/outbound-delivery.service";
import type {
	MiabCredentialSource,
	ResendCredentialSource,
} from "../apps/api/src/providers/provider-credentials";
import type {
	ResendMessage,
	ResendTransport,
} from "../apps/api/src/providers/resend-transport";
import { PrismaPg } from "../packages/db/node_modules/@prisma/adapter-pg";
import { type Db, PrismaClient } from "../packages/db/src/index";

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const appUrl = process.env.DATABASE_URL;
if (!migrationUrl || !appUrl)
	throw new Error("Phase 4 database URLs are required.");

const migration = new PrismaClient({
	adapter: new PrismaPg({ connectionString: migrationUrl }),
});
const app = new PrismaClient({
	adapter: new PrismaPg({ connectionString: appUrl }),
});
const run = `${Date.now()}`;
const owner = `phase4-owner-${run}`;
const reviewer = `phase4-reviewer-${run}`;
const mailboxId = `phase4-mailbox-${run}`;
const contactId = `phase4-contact-${run}`;

class FakeMiabCredentials implements MiabCredentialSource {
	loads = 0;
	async load(address: string) {
		this.loads += 1;
		return {
			host: "imap.phase4.test",
			port: 993 as const,
			username: address,
			password: "synthetic-secret",
		};
	}
}

class FakeMiabClient implements MiabProtocolClient {
	connects = 0;
	fetches: Array<{ folder: string; afterUid: number | null }> = [];
	constructor(
		private readonly messages: MiabFetchedMessage[],
		private readonly failure?: Error,
	) {}
	async connect() {
		this.connects += 1;
		if (this.failure) throw this.failure;
	}
	async capabilities() {
		return ["IMAP4rev1", "UIDPLUS"];
	}
	async folders() {
		return ["INBOX", "Archive"];
	}
	async fetchReadOnly(folder: string, afterUid: number | null) {
		this.fetches.push({ folder, afterUid });
		return this.messages.filter((message) => message.uid > (afterUid ?? 0));
	}
	async close() {}
}

class FakeResendCredentials implements ResendCredentialSource {
	loads = 0;
	async load() {
		this.loads += 1;
		return { apiKey: "synthetic-resend-key" };
	}
}

class FakeResendTransport implements ResendTransport {
	sends: ResendMessage[] = [];
	async send(_apiKey: string, message: ResendMessage) {
		this.sends.push(message);
		return { providerMessageId: `resend-${this.sends.length}` };
	}
}

beforeAll(async () => {
	await migration.organization.upsert({
		where: { id: "workspace" },
		create: {
			id: "workspace",
			name: "IBL Media Consultancy",
			slug: "ibl",
			createdAt: new Date(),
		},
		update: {},
	});
	for (const [userId, role] of [
		[owner, "admin"],
		[reviewer, "team"],
	] as const) {
		await migration.user.create({
			data: {
				id: userId,
				name: role,
				email: `${userId}@phase4.test`,
				emailVerified: true,
			},
		});
		await migration.userProfile.create({ data: { userId, status: "ACTIVE" } });
		await migration.member.create({
			data: {
				id: `member-${userId}`,
				organizationId: "workspace",
				userId,
				role,
				createdAt: new Date(),
			},
		});
	}
	await migration.contact.create({
		data: {
			id: contactId,
			firstName: "Provider",
			lastName: "Recipient",
			ownerId: owner,
		},
	});
	await migration.mailbox.create({
		data: {
			id: mailboxId,
			ownerUserId: owner,
			address: `${owner}@phase4.test`,
			normalizedAddress: `${owner}@phase4.test`,
			displayName: "Phase 4 Owner",
			status: "UNVERIFIED",
		},
	});
	await migration.mailboxGrant.create({
		data: {
			id: `phase4-grant-${run}`,
			mailboxId,
			granteeUserId: reviewer,
			grantedByUserId: owner,
			permission: "READ",
		},
	});
	await migration.mailboxSync.create({
		data: {
			id: `phase4-sync-${run}`,
			userId: owner,
			mailboxId,
			source: "miab",
			status: "IDLE",
		},
	});
});

afterAll(async () => {
	await migration.providerCapability.updateMany({
		data: { status: "UNVERIFIED", verifiedAt: null, evidenceReference: null },
	});
	await migration.mailbox.update({
		where: { id: mailboxId },
		data: { status: "UNVERIFIED", verifiedAt: null },
	});
	await app.$disconnect();
	await migration.$disconnect();
});

describe("MIAB read-only synchronization", () => {
	test.serial(
		"fails before credentials or protocol access while unverified",
		async () => {
			const credentials = new FakeMiabCredentials();
			const client = new FakeMiabClient([]);
			const service = new MiabSyncService(
				app as unknown as Db,
				credentials,
				() => client,
			);
			await expect(service.runMailbox(mailboxId, "worker-a")).rejects.toThrow(
				/not verified/i,
			);
			expect(credentials.loads).toBe(0);
			expect(client.connects).toBe(0);
		},
	);

	test.serial(
		"uses EXAMINE-style read-only protocol data, cursors, and deduplication",
		async () => {
			await migration.providerCapability.update({
				where: { key: "MIAB_IMAP" },
				data: {
					status: "VERIFIED",
					verifiedAt: new Date(),
					evidenceReference: "synthetic-double",
				},
			});
			await migration.mailbox.update({
				where: { id: mailboxId },
				data: { status: "VERIFIED", verifiedAt: new Date() },
			});
			const message: MiabFetchedMessage = {
				uid: 41,
				messageId: `<phase4-${run}@test>`,
				inReplyTo: null,
				references: [],
				from: { email: "sender@phase4.test", name: "Sender" },
				recipients: [{ email: `${owner}@phase4.test`, name: null, kind: "to" }],
				subject: "Synthetic message",
				body: "Synthetic body used only in the isolated test database.",
				sentAt: new Date("2026-08-09T00:00:00.000Z"),
			};
			const credentials = new FakeMiabCredentials();
			const firstClient = new FakeMiabClient([message]);
			const first = await new MiabSyncService(
				app as unknown as Db,
				credentials,
				() => firstClient,
			).runMailbox(mailboxId, "worker-b");
			expect(first).toMatchObject({ status: "synced", stored: 1, cursor: 41 });
			expect(firstClient.fetches).toEqual([
				{ folder: "INBOX", afterUid: null },
			]);
			await migration.mailboxSync.update({
				where: { id: `phase4-sync-${run}` },
				data: { retryAfter: null },
			});
			const secondClient = new FakeMiabClient([message]);
			const second = await new MiabSyncService(
				app as unknown as Db,
				credentials,
				() => secondClient,
			).runMailbox(mailboxId, "worker-c");
			expect(second).toMatchObject({ status: "synced", stored: 0, cursor: 41 });
			expect(secondClient.fetches).toEqual([{ folder: "INBOX", afterUid: 41 }]);
			expect(await migration.emailMessage.count({ where: { mailboxId } })).toBe(
				1,
			);
		},
	);

	test.serial(
		"stores only a redacted error code and schedules retry",
		async () => {
			await migration.mailboxSync.update({
				where: { id: `phase4-sync-${run}` },
				data: { retryAfter: null },
			});
			const client = new FakeMiabClient(
				[],
				new Error("AUTH synthetic-secret must never persist"),
			);
			const service = new MiabSyncService(
				app as unknown as Db,
				new FakeMiabCredentials(),
				() => client,
			);
			await expect(service.runMailbox(mailboxId, "worker-d")).rejects.toThrow(
				"AUTH_ERROR",
			);
			const sync = await migration.mailboxSync.findUniqueOrThrow({
				where: { id: `phase4-sync-${run}` },
			});
			expect(sync.lastErrorCode).toBe("AUTH_ERROR");
			expect(sync.lastError).not.toContain("synthetic-secret");
			expect(sync.retryAfter).not.toBeNull();
		},
	);
});

describe("Resend human-approved transport", () => {
	test.serial(
		"fails closed before credentials while Resend is unverified",
		async () => {
			await migration.providerCapability.update({
				where: { key: "RESEND_OUTBOUND" },
				data: {
					status: "UNVERIFIED",
					verifiedAt: null,
					evidenceReference: null,
				},
			});
			const route = await migration.contactRoute.create({
				data: {
					id: `phase4-route-${run}`,
					contactId,
					ownerUserId: owner,
					type: "EMAIL",
					value: `recipient-${run}@phase4.test`,
					normalizedValue: `recipient-${run}@phase4.test`,
					visibility: "PRIVATE",
				},
			});
			const draft = await migration.draft.create({
				data: {
					id: `phase4-draft-${run}`,
					ownerUserId: owner,
					mailboxId,
					recipientRouteId: route.id,
					subject: "Synthetic outbound",
					body: "Synthetic approved body",
					status: "DRAFT",
					idempotencyKey: `phase4-draft-${run}`,
				},
			});
			await migration.outreachApproval.create({
				data: {
					id: `phase4-approval-${run}`,
					draftId: draft.id,
					requestedById: owner,
					decidedById: reviewer,
					status: "APPROVED",
					requestedAt: new Date(),
					decidedAt: new Date(),
					idempotencyKey: `phase4-approval-${run}`,
				},
			});
			await migration.draft.update({
				where: { id: draft.id },
				data: { status: "APPROVED", approvedAt: new Date() },
			});
			const credentials = new FakeResendCredentials();
			const transport = new FakeResendTransport();
			const service = new OutboundDeliveryService(
				app as unknown as Db,
				credentials,
				transport,
			);
			await expect(service.sendApprovedDraft(owner, draft.id)).rejects.toThrow(
				/not verified/i,
			);
			expect(credentials.loads).toBe(0);
			expect(transport.sends).toHaveLength(0);
		},
	);

	test.serial(
		"derives sender server-side and sends once with stable idempotency",
		async () => {
			await migration.providerCapability.update({
				where: { key: "RESEND_OUTBOUND" },
				data: {
					status: "VERIFIED",
					verifiedAt: new Date(),
					evidenceReference: "synthetic-double",
				},
			});
			expect(
				await migration.draft.findUnique({
					where: { id: `phase4-draft-${run}` },
					select: { status: true },
				}),
			).toEqual({ status: "APPROVED" });
			const credentials = new FakeResendCredentials();
			const transport = new FakeResendTransport();
			const service = new OutboundDeliveryService(
				app as unknown as Db,
				credentials,
				transport,
			);
			const first = await service.sendApprovedDraft(
				owner,
				`phase4-draft-${run}`,
			);
			const second = await service.sendApprovedDraft(
				owner,
				`phase4-draft-${run}`,
			);
			expect(first).toMatchObject({ status: "sent", duplicate: false });
			expect(second).toMatchObject({ status: "sent", duplicate: true });
			expect(transport.sends).toHaveLength(1);
			expect(transport.sends[0]).toMatchObject({
				from: { address: `${owner}@phase4.test`, displayName: "Phase 4 Owner" },
				to: `recipient-${run}@phase4.test`,
				idempotencyKey: `ibl-outbound:phase4-draft-${run}`,
			});
			expect(
				await migration.outboundDelivery.count({
					where: { draftId: `phase4-draft-${run}` },
				}),
			).toBe(1);
		},
	);
});
