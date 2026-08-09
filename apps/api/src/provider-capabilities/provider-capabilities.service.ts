import type { Db, ProviderCapability } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import { Injectable } from "@nestjs/common";
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
}
