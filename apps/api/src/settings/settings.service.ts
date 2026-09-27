import type { Db } from "@crm/db";
import {
	maskKey,
	readContextDevKey,
	writeContextDevKey,
} from "@crm/db/settings";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ResearchKeyService } from "../agent/research-key.service";
import { BackfillService } from "../backfill/backfill.service";
import { InjectDatabase } from "../database/database.constants";
export interface ResearchKeySettings {
	configured: boolean;
	hint: string | null;
}

@Injectable()
export class SettingsService {
	private readonly logger = new Logger(SettingsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly researchKeys: ResearchKeyService,
		private readonly backfill: BackfillService,
	) {}

	async researchKey(): Promise<ResearchKeySettings> {
		const key = await readContextDevKey(this.db);

		return { configured: key !== null, hint: key ? maskKey(key) : null };
	}

	async setResearchKey(apiKey: string): Promise<ResearchKeySettings> {
		const check = await this.researchKeys.verify(apiKey);

		if (check.outcome === "invalid") {
			throw new BadRequestException(check.reason);
		}

		await writeContextDevKey(this.db, apiKey);

		this.logger.log({
			message: "Context key saved",
			verified: check.outcome === "valid",
		});

		// Every company added while there was no key is still PENDING, because a
		// brand task with nowhere to look leaves the record alone. The sign-in
		// sweep would find them, but the person who just fixed it is standing
		// here — so pick the work up now rather than on their next sign-in.
		void this.backfill
			.run("companies")
			.then(({ queued, remaining }) => {
				if (queued > 0) {
					this.logger.log({
						message: "Queued the research that was waiting on a key",
						queued,
						remaining,
					});
				}
			})
			.catch((error: unknown) => {
				this.logger.warn(
					{ message: "Could not queue the waiting research" },
					error instanceof Error ? error.stack : String(error),
				);
			});

		return this.researchKey();
	}
}
