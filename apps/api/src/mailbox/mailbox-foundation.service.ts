import type { Db } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

const SELECT = {
	id: true,
	ownerUserId: true,
	address: true,
	displayName: true,
	signature: true,
	status: true,
	provider: true,
	verifiedAt: true,
} as const;

@Injectable()
export class MailboxFoundationService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	listAccessible(userId: string) {
		return withPrincipal(this.db, { userId, kind: "user" }, (tx) =>
			tx.mailbox.findMany({ select: SELECT, orderBy: { address: "asc" } }),
		);
	}

	get(userId: string, mailboxId: string) {
		return withPrincipal(this.db, { userId, mailboxId, kind: "user" }, (tx) =>
			tx.mailbox.findUniqueOrThrow({
				where: { id: mailboxId },
				select: SELECT,
			}),
		);
	}

	updateOwnedIdentity(
		userId: string,
		input: {
			mailboxId: string;
			address: string;
			displayName: string | null;
			signature: string | null;
		},
	) {
		const normalizedAddress = input.address.trim().toLowerCase();
		return withPrincipal(
			this.db,
			{ userId, mailboxId: input.mailboxId, kind: "user" },
			(tx) =>
				tx.mailbox.update({
					where: { id: input.mailboxId },
					data: {
						address: input.address.trim(),
						normalizedAddress,
						displayName: input.displayName,
						signature: input.signature,
					},
					select: SELECT,
				}),
		);
	}
}
