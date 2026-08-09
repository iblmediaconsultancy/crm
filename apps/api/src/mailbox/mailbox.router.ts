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
import {
	mailboxIdInput,
	updateOwnedMailboxIdentityInput,
} from "./mailbox.contracts";
import { MailboxFoundationService } from "./mailbox-foundation.service";

@Router({ alias: "mailbox" })
@UseMiddlewares(AuthMiddleware)
export class MailboxRouter {
	constructor(
		@Inject(MailboxFoundationService)
		private readonly mailbox: MailboxFoundationService,
	) {}

	@Query()
	listAccessible(@Ctx() ctx: AuthedTrpcContext) {
		return this.mailbox.listAccessible(ctx.user.id);
	}

	@Query({ input: mailboxIdInput })
	get(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof mailboxIdInput>,
	) {
		return this.mailbox.get(ctx.user.id, input.mailboxId);
	}

	@Mutation({ input: updateOwnedMailboxIdentityInput })
	updateOwnedIdentity(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof updateOwnedMailboxIdentityInput>,
	) {
		return this.mailbox.updateOwnedIdentity(ctx.user.id, input);
	}
}
