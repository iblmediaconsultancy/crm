import { Module } from "@nestjs/common";
import { MailboxModule } from "../mailbox/mailbox.module";
import { AttachmentStorageService } from "./attachment-storage.service";
import { MessageAttachmentController } from "./message-attachment.controller";
import { MiabSentSyncService } from "./miab-sent-sync.service";
import { defaultMiabProviders, MiabSyncService } from "./miab-sync.service";
import { OrganizationProtectionService } from "./organization-protection.service";
import { OutboundDeliveryService } from "./outbound-delivery.service";
import { OutreachLifecycleService } from "./outreach-lifecycle.service";
import {
	defaultPostgresJobProviders,
	PostgresJobWorkerService,
} from "./postgres-job-worker.service";
import { ResendWebhookController } from "./resend-webhook.controller";

@Module({
	controllers: [MessageAttachmentController, ResendWebhookController],
	imports: [MailboxModule],
	providers: [
		AttachmentStorageService,
		MiabSyncService,
		MiabSentSyncService,
		OutboundDeliveryService,
		OutreachLifecycleService,
		OrganizationProtectionService,
		PostgresJobWorkerService,
		...defaultMiabProviders,
		...defaultPostgresJobProviders,
	],
	exports: [
		AttachmentStorageService,
		MiabSyncService,
		MiabSentSyncService,
		OutboundDeliveryService,
		OutreachLifecycleService,
		OrganizationProtectionService,
		PostgresJobWorkerService,
	],
})
export class ProvidersModule {}
