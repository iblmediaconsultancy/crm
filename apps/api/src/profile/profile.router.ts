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
import { updateOwnProfileInput } from "./profile.contracts";
import { ProfileService, type ProfileView } from "./profile.service";

@Router({ alias: "profile" })
@UseMiddlewares(AuthMiddleware)
export class ProfileRouter {
	constructor(
		@Inject(ProfileService) private readonly profile: ProfileService,
	) {}

	@Query()
	get(@Ctx() ctx: AuthedTrpcContext): Promise<ProfileView> {
		return this.profile.get(ctx.user.id);
	}

	@Mutation({ input: updateOwnProfileInput })
	updateOwn(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof updateOwnProfileInput>,
	): Promise<ProfileView> {
		return this.profile.updateOwn(ctx.user.id, input);
	}
}
