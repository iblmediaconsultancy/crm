import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import type { Db } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import { WORKSPACE_ID } from "@crm/db/workspace";
import {
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type { MiabAttachment } from "./miab-imap.client";

const MAX_ATTACHMENTS = 50;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const CLAIM = `UPDATE "attachmentScanJob" SET "status"='LEASED', "leaseOwner"=$1, "leasedUntil"=NOW()+INTERVAL '120 seconds', "attemptCount"="attemptCount"+1, "updatedAt"=NOW() WHERE "id"=(SELECT "id" FROM "attachmentScanJob" WHERE "status" IN ('PENDING','FAILED','LEASED') AND ("retryAt" IS NULL OR "retryAt"<=NOW()) AND ("leasedUntil" IS NULL OR "leasedUntil"<=NOW()) AND "attemptCount"<"maxAttempts" ORDER BY "createdAt","id" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING "id","attachmentId","attemptCount"`;
type Claim = { id: string; attachmentId: string; attemptCount: number };

@Injectable()
export class AttachmentStorageService {
	private client: S3Client | null = null;
	constructor(@InjectDatabase() private readonly db: Db) {}

	async ingest(
		mailboxId: string,
		messageId: string,
		attachments: MiabAttachment[],
	) {
		if (!attachments.length) return [];
		if (attachments.length > MAX_ATTACHMENTS)
			throw new Error("MIME_TOO_MANY_ATTACHMENTS");
		if (
			attachments.reduce((sum, item) => sum + item.size, 0) > MAX_TOTAL_BYTES
		) {
			throw new Error("MIME_ATTACHMENTS_TOO_LARGE");
		}
		const s3 = await this.s3();
		const bucket = this.bucket();
		const attachmentIds: string[] = [];
		let unpersistedObjectKey: string | null = null;
		try {
			for (const item of attachments) {
				if (
					item.size > MAX_ATTACHMENT_BYTES ||
					item.size !== item.content.byteLength
				) {
					throw new Error("MIME_ATTACHMENT_TOO_LARGE");
				}
				const checksumSha256 = createHash("sha256")
					.update(item.content)
					.digest("hex");
				const filename = safeFilename(item.filename ?? "attachment.bin");
				const objectKey = `mailboxes/${mailboxId}/messages/${messageId}/${checksumSha256}-${filename}`;
				const existing = await this.db.messageAttachment.findUnique({
					where: { objectKey },
					select: { id: true, status: true },
				});
				if (!existing) unpersistedObjectKey = objectKey;
				await s3.send(
					new PutObjectCommand({
						Bucket: bucket,
						Key: objectKey,
						Body: item.content,
						ContentType: item.contentType,
						Metadata: {
							disposition: item.disposition,
							checksum: checksumSha256,
						},
					}),
				);
				const archive =
					/(?:zip|rar|7z|tar|gzip|compressed)/i.test(item.contentType) ||
					/\.(?:zip|rar|7z|tar|gz)$/i.test(filename);
				const row =
					existing ??
					(await this.db.messageAttachment.create({
						data: {
							mailboxId,
							messageId,
							filename,
							mediaType: item.contentType,
							contentId: item.contentId,
							disposition: item.disposition,
							byteSize: item.size,
							checksumSha256,
							objectKey,
							status: archive ? "REJECTED" : "QUARANTINED",
						},
						select: { id: true, status: true },
					}));
				unpersistedObjectKey = null;
				attachmentIds.push(row.id);
				if (row.status === "QUARANTINED") {
					await this.db.attachmentScanJob.upsert({
						where: { attachmentId: row.id },
						create: {
							attachmentId: row.id,
							idempotencyKey: `attachment-scan:${row.id}`,
						},
						update: {},
					});
				}
			}
			return attachmentIds;
		} catch (error) {
			if (unpersistedObjectKey) {
				await s3
					.send(
						new DeleteObjectCommand({
							Bucket: bucket,
							Key: unpersistedObjectKey,
						}),
					)
					.catch(() => undefined);
			}
			throw error;
		}
	}

	async download(attachmentId: string, userId: string) {
		const active = await this.db.user.findFirst({
			where: {
				id: userId,
				profile: { status: "ACTIVE" },
				members: { some: { organizationId: WORKSPACE_ID } },
			},
			select: { id: true },
		});
		if (!active)
			throw new NotFoundException(
				"Clean attachment was not found or is not authorized.",
			);
		const row = await this.db.messageAttachment.findFirst({
			where: {
				id: attachmentId,
				status: "CLEAN",
				OR: [
					{
						mailboxId: {
							in: (
								await this.db.mailbox.findMany({
									where: {
										OR: [
											{ ownerUserId: userId },
											{
												grants: {
													some: { granteeUserId: userId, revokedAt: null },
												},
											},
										],
									},
									select: { id: true },
								})
							).map((mailbox) => mailbox.id),
						},
					},
				],
			},
		});
		if (!row)
			throw new NotFoundException(
				"Clean attachment was not found or is not authorized.",
			);
		const response = await (await this.s3()).send(
			new GetObjectCommand({ Bucket: this.bucket(), Key: row.objectKey }),
		);
		if (!response.Body)
			throw new NotFoundException("Attachment bytes are unavailable.");
		return {
			...row,
			content: Buffer.from(await response.Body.transformToByteArray()),
		};
	}

	async runDue(workerId: string) {
		let processed = 0;
		for (let i = 0; i < 25; i += 1) {
			const rows = await withPrincipal(
				this.db,
				{ userId: null, kind: "worker" },
				(tx) => tx.$queryRawUnsafe<Claim[]>(CLAIM, workerId),
			);
			const job = rows[0];
			if (!job) break;
			try {
				await this.scan(job, workerId);
			} catch (error) {
				await this.fail(job, workerId, error);
			}
			processed += 1;
		}
		return processed;
	}

	private async scan(job: Claim, workerId: string) {
		const row = await withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			(tx) =>
				tx.messageAttachment.findUnique({ where: { id: job.attachmentId } }),
		);
		if (!row || row.status !== "QUARANTINED") {
			await withPrincipal(this.db, { userId: null, kind: "worker" }, (tx) =>
				tx.attachmentScanJob.updateMany({
					where: { id: job.id, leaseOwner: workerId },
					data: { status: "CANCELLED", leaseOwner: null, leasedUntil: null },
				}),
			);
			return;
		}
		const response = await (await this.s3()).send(
			new GetObjectCommand({ Bucket: this.bucket(), Key: row.objectKey }),
		);
		if (!response.Body) throw new Error("ATTACHMENT_OBJECT_MISSING");
		const content = Buffer.from(await response.Body.transformToByteArray());
		if (
			content.byteLength !== row.byteSize ||
			createHash("sha256").update(content).digest("hex") !== row.checksumSha256
		)
			throw new Error("ATTACHMENT_INTEGRITY_FAILED");
		const verdict = await clamScan(content);
		await withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				await tx.messageAttachment.update({
					where: { id: row.id },
					data: {
						status: verdict === "CLEAN" ? "CLEAN" : "INFECTED",
						scanCompletedAt: new Date(),
					},
				});
				await tx.attachmentScanJob.updateMany({
					where: { id: job.id, leaseOwner: workerId },
					data: {
						status: "SUCCEEDED",
						leaseOwner: null,
						leasedUntil: null,
						retryAt: null,
						lastErrorCode: null,
					},
				});
			},
		);
	}

	private fail(job: Claim, workerId: string, error: unknown) {
		const dead = job.attemptCount >= 5;
		return withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				await tx.attachmentScanJob.updateMany({
					where: { id: job.id, leaseOwner: workerId },
					data: {
						status: dead ? "DEAD" : "FAILED",
						leaseOwner: null,
						leasedUntil: null,
						retryAt: dead
							? null
							: new Date(
									Date.now() + Math.min(3600000, 15000 * 2 ** job.attemptCount),
								),
						lastErrorCode:
							error instanceof Error
								? error.message.slice(0, 100)
								: "ATTACHMENT_SCAN_FAILED",
					},
				});
				if (dead)
					await tx.messageAttachment.update({
						where: { id: job.attachmentId },
						data: { status: "SCAN_FAILED" },
					});
			},
		);
	}

	private async s3() {
		if (this.client) return this.client;
		const endpoint = required("OBJECT_STORAGE_ENDPOINT");
		const region = required("OBJECT_STORAGE_REGION");
		const accessKeyId = await secret(
			"OBJECT_STORAGE_ACCESS_KEY_FILE",
			"OBJECT_STORAGE_ACCESS_KEY",
		);
		const secretAccessKey = await secret(
			"OBJECT_STORAGE_SECRET_KEY_FILE",
			"OBJECT_STORAGE_SECRET_KEY",
		);
		this.client = new S3Client({
			endpoint,
			region,
			forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === "1",
			credentials: { accessKeyId, secretAccessKey },
		});
		return this.client;
	}
	private bucket() {
		return required("OBJECT_STORAGE_BUCKET");
	}
}

function required(name: string) {
	const value = process.env[name]?.trim();
	if (!value) throw new ConflictException(`${name} is not configured.`);
	return value;
}
async function secret(fileName: string, legacyName: string) {
	const path = process.env[fileName]?.trim();
	if (path) return (await readFile(path, "utf8")).trim();
	const value = process.env[legacyName]?.trim();
	if (value && process.env.NODE_ENV !== "production") return value;
	throw new ConflictException(`${fileName} is not configured.`);
}
function safeFilename(value: string) {
	return (
		value
			.normalize("NFKC")
			.replace(/[\p{Cc}/\\:]+/gu, "_")
			.replace(/^\.+/, "")
			.slice(0, 180) || "attachment.bin"
	);
}
function clamScan(content: Buffer): Promise<"CLEAN" | "INFECTED"> {
	return new Promise((resolve, reject) => {
		const socket = connect({
			host: required("CLAMAV_HOST"),
			port: Number(process.env.CLAMAV_PORT ?? 3310),
		});
		const output: Buffer[] = [];
		socket.setTimeout(120000);
		socket.on("connect", () => {
			socket.write("zINSTREAM\0");
			for (let offset = 0; offset < content.length; offset += 64 * 1024) {
				const chunk = content.subarray(offset, offset + 64 * 1024);
				const size = Buffer.alloc(4);
				size.writeUInt32BE(chunk.length);
				socket.write(size);
				socket.write(chunk);
			}
			socket.write(Buffer.alloc(4));
		});
		socket.on("data", (data) => output.push(data));
		socket.on("end", () => {
			const verdict = Buffer.concat(output).toString("utf8");
			if (verdict.includes("FOUND")) resolve("INFECTED");
			else if (verdict.includes("OK")) resolve("CLEAN");
			else reject(new Error("CLAMAV_INVALID_RESPONSE"));
		});
		socket.on("timeout", () => socket.destroy(new Error("CLAMAV_TIMEOUT")));
		socket.on("error", reject);
	});
}
