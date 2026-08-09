import type { Db, ProviderCapability } from "@crm/db";
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
}
