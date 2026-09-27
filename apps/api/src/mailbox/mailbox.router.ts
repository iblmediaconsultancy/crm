import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { PermissionMiddleware } from "../trpc/middlewares/permission.middleware";
import {
	mailboxEventInput,
	mailboxIdInput,
	mailboxThreadInput,
	updateOwnedMailboxIdentityInput,
} from "./mailbox.contracts";
import { MailboxConversationService } from "./mailbox-conversation.service";
import { MailboxFoundationService } from "./mailbox-foundation.service";

@Router({ alias: "mailbox" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class MailboxRouter {
	constructor(
		@Inject(MailboxFoundationService)
		private readonly mailbox: MailboxFoundationService,
		@Inject(MailboxConversationService)
		private readonly conversations: MailboxConversationService,
	) {}

	@Query({ meta: { permission: "crm.read" } })
	listAccessible(@Ctx() ctx: AuthedTrpcContext) {
		return this.mailbox.listAccessible(ctx.user.id);
	}

	@Query({ input: mailboxIdInput, meta: { permission: "crm.read" } })
	get(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof mailboxIdInput>,
	) {
		return this.mailbox.get(ctx.user.id, input.mailboxId);
	}

	@Mutation({ input: updateOwnedMailboxIdentityInput, meta: { permission: "workspace.manage" } })
	updateOwnedIdentity(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof updateOwnedMailboxIdentityInput>,
	) {
		return this.mailbox.updateOwnedIdentity(ctx.user.id, input);
	}

	@Query({ input: mailboxThreadInput, meta: { permission: "crm.read" } })
	thread(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof mailboxThreadInput>,
	) {
		return this.conversations.thread(ctx.user.id, input.threadId);
	}

	@Query({ input: mailboxEventInput, meta: { permission: "crm.read" } })
	event(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof mailboxEventInput>,
	) {
		return this.conversations.event(ctx.user.id, input.eventId);
	}
}
