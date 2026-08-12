import { Module } from "@nestjs/common";
import { MailboxModule } from "../mailbox/mailbox.module";
import { AttachmentStorageService } from "./attachment-storage.service";
import { MessageAttachmentController } from "./message-attachment.controller";
import { defaultMiabProviders, MiabSyncService } from "./miab-sync.service";
import { OutboundDeliveryService } from "./outbound-delivery.service";
import { OutreachLifecycleService } from "./outreach-lifecycle.service";
import { ResendWebhookController } from "./resend-webhook.controller";
import {
	defaultPostgresJobProviders,
	PostgresJobWorkerService,
} from "./postgres-job-worker.service";

@Module({
	controllers: [MessageAttachmentController, ResendWebhookController],
	imports: [MailboxModule],
	providers: [
		AttachmentStorageService,
		MiabSyncService,
		OutboundDeliveryService,
		OutreachLifecycleService,
		PostgresJobWorkerService,
		...defaultMiabProviders,
		...defaultPostgresJobProviders,
	],
	exports: [AttachmentStorageService, MiabSyncService, OutboundDeliveryService, OutreachLifecycleService, PostgresJobWorkerService],
})
export class ProvidersModule {}