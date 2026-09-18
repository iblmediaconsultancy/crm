import type { Db, ProviderCapability } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import {
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

@Injectable()
export class ProviderCapabilitiesService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	get(): Promise<ProviderCapability[]> {
		return this.db.providerCapability.findMany({
			select: {
				key: true,
				status: true,
				evidenceReference: true,
				verifiedAt: true,
				updatedAt: true,
			},
			orderBy: { key: "asc" },
		});
	}

	operations(userId: string) {
		return withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			const syncs = await tx.mailboxSync.groupBy({
				by: ["status"],
				where: { source: "miab", userId },
				_count: { _all: true },
			});
			const deliveries = await tx.outboundDelivery.groupBy({
				by: ["status"],
				_count: { _all: true },
			});
			return {
				miabSyncs: syncs.map((row) => ({
					status: row.status,
					count: row._count._all,
				})),
				outboundDeliveries: deliveries.map((row) => ({
					status: row.status,
					count: row._count._all,
				})),
			};
		});
	}

	mailboxVerification(userId: string) {
		return withPrincipal(
			this.db,
			{ userId, kind: "user" },
			(tx) =>
				tx.$queryRaw<
					Array<{
						id: string;
						address: string;
						status: string;
						verifiedAt: Date | null;
					}>
				>`SELECT * FROM ibl_outreach_mailbox_status()`,
		);
	}

	verifyMailbox(userId: string) {
		return withPrincipal(this.db, { userId, kind: "user" }, async (tx) => {
			const capability = await tx.providerCapability.findUnique({
				where: { key: "MIAB_IMAP" },
				select: { status: true },
			});
			if (capability?.status !== "VERIFIED") {
				throw new ConflictException(
					"Complete the MIAB provider probe before verifying the mailbox.",
				);
			}
			const rows = await tx.$queryRaw<
				Array<{
					id: string;
					address: string;
					status: string;
					verifiedAt: Date | null;
				}>
			>`SELECT * FROM ibl_verify_outreach_mailbox()`;
			const mailbox = rows[0];
			if (!mailbox)
				throw new NotFoundException("Seeded outreach mailbox was not found.");
			await tx.securityAuditEvent.create({
				data: {
					actorUserId: userId,
					action: "MAILBOX_VERIFIED",
					resourceType: "Mailbox",
					resourceId: mailbox.id,
					outcome: "SUCCESS",
					metadata: { address: mailbox.address, provider: "MIAB" },
				},
			});
			return mailbox;
		});
	}
}
