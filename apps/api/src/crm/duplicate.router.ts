import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { PermissionMiddleware } from "../trpc/middlewares/permission.middleware";
import { duplicateCandidateInput, duplicateDismissInput, duplicateListInput, duplicateMergeInput } from "./duplicate.contracts";
import { DuplicateService } from "./duplicate.service";

@Router({ alias: "duplicates" })
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class DuplicateRouter {
  constructor(private readonly duplicates: DuplicateService) {}

  @Query({ input: duplicateListInput, meta: { permission: "duplicates.review" } })
  list(@Input() input: z.infer<typeof duplicateListInput>) { return this.duplicates.list(input); }

  @Query({ input: duplicateCandidateInput, meta: { permission: "duplicates.review" } })
  preview(@Input("candidateId") candidateId: string) { return this.duplicates.preview(candidateId); }

  @Mutation({ input: duplicateDismissInput, meta: { permission: "duplicates.review" } })
  dismiss(@Ctx() ctx: AuthedTrpcContext, @Input() input: z.infer<typeof duplicateDismissInput>) { return this.duplicates.dismiss(input.candidateId, ctx.user.id, input.reason); }

  @Mutation({ input: duplicateMergeInput, meta: { permission: "duplicates.review" } })
  merge(@Ctx() ctx: AuthedTrpcContext, @Input() input: z.infer<typeof duplicateMergeInput>) { return this.duplicates.merge(input, ctx.user.id); }
}