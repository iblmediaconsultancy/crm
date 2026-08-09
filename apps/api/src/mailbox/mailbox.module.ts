import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { CompaniesModule } from "../companies/companies.module";
import { TrpcModule } from "../trpc/trpc.module";
import { MailboxRouter } from "./mailbox.router";
import { MailboxApiClient } from "./mailbox-api.client";
import { MailboxFoundationService } from "./mailbox-foundation.service";
import { MailboxMatchService } from "./mailbox-match.service";
import { MailboxTokenService } from "./mailbox-token.service";
import { SyncStateService } from "./sync-state.service";
import { ThreadWriterService } from "./thread-writer.service";

@Module({
	imports: [AgentModule, CompaniesModule, TrpcModule],
	providers: [
		MailboxApiClient,
		MailboxFoundationService,
		MailboxMatchService,
		MailboxRouter,
		MailboxTokenService,
		SyncStateService,
		ThreadWriterService,
	],
	exports: [
		MailboxApiClient,
		MailboxFoundationService,
		MailboxMatchService,
		MailboxTokenService,
		SyncStateService,
		ThreadWriterService,
	],
})
export class MailboxModule {}
