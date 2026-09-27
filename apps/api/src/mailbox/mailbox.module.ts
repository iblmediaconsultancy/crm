import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { CompaniesModule } from "../companies/companies.module";
import { TrpcModule } from "../trpc/trpc.module";
import { MailboxRouter } from "./mailbox.router";
import { MailboxApiClient } from "./mailbox-api.client";
import { MailboxConversationService } from "./mailbox-conversation.service";
import { MailboxFoundationService } from "./mailbox-foundation.service";
import { MailboxMatchService } from "./mailbox-match.service";
import { ThreadWriterService } from "./thread-writer.service";

@Module({
	imports: [AgentModule, CompaniesModule, TrpcModule],
	providers: [
		MailboxApiClient,
		MailboxConversationService,
		MailboxFoundationService,
		MailboxMatchService,
		MailboxRouter,
		ThreadWriterService,
	],
	exports: [
		MailboxApiClient,
		MailboxConversationService,
		MailboxFoundationService,
		MailboxMatchService,
		ThreadWriterService,
	],
})
export class MailboxModule {}
