import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { MailboxFoundationService } from "./mailbox-foundation.service";
import { MailboxRouter } from "./mailbox.router";

@Module({
	imports: [TrpcModule],
	providers: [MailboxFoundationService, MailboxRouter],
	exports: [MailboxFoundationService],
})
export class MailboxModule {}
