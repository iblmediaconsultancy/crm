import { Global, Module } from "@nestjs/common";
import { ActivityStampService } from "./activity-stamp.service";
import { CanonicalLifecycleService } from "./canonical-lifecycle.service";
import { EnrichmentLogService } from "./enrichment-log.service";
import { DuplicateService } from "./duplicate.service";

@Global()
@Module({
	providers: [ActivityStampService, CanonicalLifecycleService, DuplicateService, EnrichmentLogService],
	exports: [ActivityStampService, CanonicalLifecycleService, DuplicateService, EnrichmentLogService],
})
export class CrmModule {}
