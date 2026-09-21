import type { Db } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	MIAB_CREDENTIAL_SOURCE,
	MIAB_PROTOCOL_FACTORY,
} from "./miab-sync.service";
import type { MiabProtocolClient } from "./miab-imap.client";
import type { MiabCredentialSource } from "./provider-credentials";

export const SENT_SYNC_MAX_ATTEMPTS = 5;

type ClaimedSentSync = { id: string };
type DeliveryForSentSync = {
	id: string;
	status: string;
	sentAt: Date | null;
	providerMessageId: string | null;
	sentSyncAttempts: number;
	sentSyncStatus: SentSyncStatus;
	draft: {
		id: string;
		subject: string | null;
		body: string;
		mailbox: { address: string; displayName: string | null } | null;
		recipientRoute: { normalizedValue: string } | null;
	};
};

@Injectable()
export class MiabSentSyncService {
	private readonly logger = new Logger(MiabSentSyncService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(MIAB_CREDENTIAL_SOURCE)
		private readonly credentials: MiabCredentialSource,
		@Inject(MIAB_PROTOCOL_FACTORY)
		private readonly createClient: () => MiabProtocolClient,
	) {}

	async runDue(workerId: string): Promise<number> {
		let processed = 0;
		for (let index = 0; index < 25; index += 1) {
			if (!(await this.runNext(workerId))) break;
			processed += 1;
		}
		return processed;
	}

	async runNext(workerId: string): Promise<boolean> {
		const claimed = await this.claim(workerId);
		if (!claimed) return false;
		await this.syncClaimed(claimed, workerId);
		return true;
	}

	private claim(workerId: string) {
		return withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				const rows = await tx.$queryRawUnsafe<ClaimedSentSync[]>(
					`UPDATE "outboundDelivery"
					 SET "sentSyncLeaseOwner" = $1,
					     "sentSyncLeasedUntil" = NOW() + INTERVAL '5 minutes',
					     "sentSyncAttempts" = "sentSyncAttempts" + 1,
					     "sentSyncStatus" = 'RETRY',
					     "updatedAt" = NOW()
					 WHERE "id" = (
					   SELECT "id" FROM "outboundDelivery"
					   WHERE "status" IN ('SENT', 'DELIVERED', 'REPLIED')
					     AND "sentSyncStatus" IN ('PENDING', 'RETRY')
					     AND ("sentSyncRetryAt" IS NULL OR "sentSyncRetryAt" <= NOW())
					     AND ("sentSyncLeasedUntil" IS NULL OR "sentSyncLeasedUntil" <= NOW())
					   ORDER BY "createdAt", "id"
					   FOR UPDATE SKIP LOCKED
					   LIMIT 1
					 )
					 RETURNING "id"`,
					workerId,
				);
				return rows[0]?.id ?? null;
			},
		);
	}

	private async syncClaimed(deliveryId: string, workerId: string) {
		try {
			const delivery = await withPrincipal(
				this.db,
				{ userId: null, kind: "worker" },
				(tx) =>
					tx.outboundDelivery.findUnique({
						where: { id: deliveryId },
						select: {
							id: true,
							status: true,
							sentAt: true,
							providerMessageId: true,
							sentSyncAttempts: true,
							sentSyncStatus: true,
							draft: {
								select: {
									id: true,
									subject: true,
									body: true,
									mailbox: {
										select: { address: true, displayName: true },
									},
									recipientRoute: {
										select: { normalizedValue: true },
									},
								},
							},
						},
					}),
			);
			if (!delivery?.sentAt || !delivery.draft.mailbox || !delivery.draft.recipientRoute) {
				throw new Error("SENT_SYNC_MESSAGE_DATA_MISSING");
			}
			const messageId = `<ibl-${delivery.draft.id}@iblmedia.com>`;
			const secret = await this.credentials.load(delivery.draft.mailbox.address);
			const client = this.createClient();
			try {
				await client.connect(secret);
				const folder = selectSentFolder(await client.folders());
				if (!folder) throw new Error("MIAB_SENT_FOLDER_NOT_FOUND");
				const alreadyPresent = await client.hasMessageId(folder, messageId);
				const uid = alreadyPresent
					? null
					: await client.append(
							folder,
							buildRfc822Message({
								messageId,
								deliveryId,
								providerMessageId: delivery.providerMessageId,
								fromEmail: delivery.draft.mailbox.address,
								fromName: delivery.draft.mailbox.displayName,
								toEmail: delivery.draft.recipientRoute.normalizedValue,
								subject: delivery.draft.subject,
								body: delivery.draft.body,
								sentAt: delivery.sentAt,
							}),
							delivery.sentAt,
						);
				await withPrincipal(
					this.db,
					{ userId: null, kind: "worker" },
					(tx) =>
						tx.outboundDelivery.updateMany({
							where: { id: deliveryId, sentSyncLeaseOwner: workerId },
							data: {
								sentSyncStatus: "SYNCED",
								sentSyncAt: new Date(),
								sentSyncFolder: folder,
								sentSyncUid: uid === null ? undefined : String(uid),
								sentSyncRetryAt: null,
								sentSyncErrorCode: null,
								sentSyncLeaseOwner: null,
								sentSyncLeasedUntil: null,
							},
						}),
				);
				this.logger.log({
					message: alreadyPresent
						? "MIAB Sent copy already present"
						: "MIAB Sent copy appended",
					deliveryId,
					folder,
				});
			} finally {
				await client.close().catch(() => undefined);
			}
		} catch (error) {
			const code = error instanceof Error ? error.message.slice(0, 100) : "MIAB_SENT_SYNC_FAILED";
			await withPrincipal(
				this.db,
				{ userId: null, kind: "worker" },
				async (tx) => {
					const current = await tx.outboundDelivery.findUnique({
						where: { id: deliveryId },
						select: { sentSyncAttempts: true },
					});
					const dead =
						(current?.sentSyncAttempts ?? SENT_SYNC_MAX_ATTEMPTS) >=
						SENT_SYNC_MAX_ATTEMPTS;
					await tx.outboundDelivery.updateMany({
						where: { id: deliveryId, sentSyncLeaseOwner: workerId },
						data: {
							sentSyncStatus: dead ? "FAILED" : "RETRY",
							sentSyncErrorCode: code,
							sentSyncRetryAt: dead
								? null
								: new Date(Date.now() + 15_000),
							sentSyncLeaseOwner: null,
							sentSyncLeasedUntil: null,
						},
					});
				},
			);
			this.logger.warn({
				message: "MIAB Sent copy sync failed",
				deliveryId,
				code,
			});
		}
	}
}

export function selectSentFolder(folders: string[]): string | null {
	const normalized = folders.map((folder) => ({ folder, value: folder.trim().toLowerCase() }));
	return (
		normalized.find(({ value }) => ["sent", "sent items", "sent mail"].includes(value))?.folder ??
		normalized.find(({ value }) => /(^|[/. ])sent([/. ]|$)/i.test(value))?.folder ??
		normalized.find(({ value }) => value.includes("sent"))?.folder ??
		null
	);
}

export function buildRfc822Message(input: {
	messageId: string;
	deliveryId: string;
	providerMessageId: string | null;
	fromEmail: string;
	fromName: string | null;
	toEmail: string;
	subject: string | null;
	body: string;
	sentAt: Date;
}): Uint8Array {
	const lines = [
		`Date: ${input.sentAt.toUTCString()}`,
		`From: ${formatAddress(input.fromName, input.fromEmail)}`,
		`To: ${input.toEmail}`,
		`Subject: ${encodeHeader(input.subject ?? "")}`,
		`Message-ID: ${input.messageId}`,
		`X-IBL-CRM-Delivery-ID: ${input.deliveryId}`,
		...(input.providerMessageId
			? [`X-IBL-Resend-Message-ID: ${input.providerMessageId}`]
			: []),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		input.body.replace(/\r?\n/g, "\r\n"),
	];
	return new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
}

function formatAddress(name: string | null, email: string): string {
	return name ? `${encodeHeader(name)} <${email}>` : email;
}

function encodeHeader(value: string): string {
	const sanitized = value.replace(/[\r\n]/g, " ").trim();
	if (/^[\x20-\x7e]*$/.test(sanitized)) return sanitized;
	return `=?UTF-8?B?${Buffer.from(sanitized, "utf8").toString("base64")}?=`;
}
