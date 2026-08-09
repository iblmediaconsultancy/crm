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
import { OutboundDeliveryService } from "../providers/outbound-delivery.service";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import {
	approvalDecisionInput,
	approvalRequestInput,
	assignmentCreateInput,
	contactRouteCreateInput,
	contactRouteShareInput,
	draftApproveInput,
	draftCreateInput,
	footballProfileInput,
	leadCreateInput,
	noteCreateInput,
	operationsListInput,
	organizationProfileInput,
	proofCreateInput,
	proposalCreateInput,
	representationCreateInput,
	representationTransitionInput,
	researchRequestCreateInput,
	taskCreateInput,
	taskTransitionInput,
	templateCreateInput,
} from "./operations.contracts";
import { OperationsService } from "./operations.service";

@Router({ alias: "operations" })
@UseMiddlewares(AuthMiddleware)
export class OperationsRouter {
	constructor(
		@Inject(OperationsService) private readonly operations: OperationsService,
		@Inject(OutboundDeliveryService)
		private readonly outbound: OutboundDeliveryService,
	) {}

	@Query()
	overview(@Ctx() ctx: AuthedTrpcContext) {
		return this.operations.overview(ctx.user.id);
	}

	@Query({ input: operationsListInput })
	directory(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof operationsListInput>,
	) {
		return this.operations.directory(ctx.user.id, input);
	}

	@Query({ input: operationsListInput })
	workbench(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof operationsListInput>,
	) {
		return this.operations.workbench(ctx.user.id, input);
	}

	@Mutation({ input: footballProfileInput })
	saveFootballProfile(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof footballProfileInput>,
	) {
		return this.operations.saveFootballProfile(ctx.user.id, input);
	}

	@Mutation({ input: organizationProfileInput })
	saveOrganizationProfile(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof organizationProfileInput>,
	) {
		return this.operations.saveOrganizationProfile(ctx.user.id, input);
	}

	@Mutation({ input: representationCreateInput })
	createRepresentation(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof representationCreateInput>,
	) {
		return this.operations.createRepresentation(ctx.user.id, input);
	}

	@Mutation({ input: representationTransitionInput })
	transitionRepresentation(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof representationTransitionInput>,
	) {
		return this.operations.transitionRepresentation(ctx.user.id, input);
	}

	@Mutation({ input: contactRouteCreateInput })
	createRoute(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof contactRouteCreateInput>,
	) {
		return this.operations.createRoute(ctx.user.id, input);
	}

	@Mutation({ input: contactRouteShareInput })
	shareRoute(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof contactRouteShareInput>,
	) {
		return this.operations.shareRoute(ctx.user.id, input);
	}

	@Mutation({ input: leadCreateInput })
	createLead(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof leadCreateInput>,
	) {
		return this.operations.createLead(ctx.user.id, input);
	}

	@Mutation({ input: taskCreateInput })
	createTask(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof taskCreateInput>,
	) {
		return this.operations.createTask(ctx.user.id, input);
	}

	@Mutation({ input: taskTransitionInput })
	transitionTask(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof taskTransitionInput>,
	) {
		return this.operations.transitionTask(ctx.user.id, input);
	}

	@Mutation({ input: noteCreateInput })
	createNote(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof noteCreateInput>,
	) {
		return this.operations.createNote(ctx.user.id, input);
	}

	@Mutation({ input: assignmentCreateInput })
	assign(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof assignmentCreateInput>,
	) {
		return this.operations.assign(ctx.user.id, input);
	}

	@Mutation({ input: researchRequestCreateInput })
	requestResearch(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof researchRequestCreateInput>,
	) {
		return this.operations.requestResearch(ctx.user.id, input);
	}

	@Mutation({ input: templateCreateInput })
	createTemplate(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof templateCreateInput>,
	) {
		return this.operations.createTemplate(ctx.user.id, input);
	}

	@Mutation({ input: draftCreateInput })
	createDraft(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof draftCreateInput>,
	) {
		return this.operations.createDraft(ctx.user.id, input);
	}

	@Mutation({ input: approvalRequestInput })
	requestApproval(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof approvalRequestInput>,
	) {
		return this.operations.requestApproval(ctx.user.id, input);
	}

	@Mutation({ input: approvalDecisionInput })
	decideApproval(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof approvalDecisionInput>,
	) {
		return this.operations.decideApproval(ctx.user.id, input);
	}

	@Mutation({ input: draftApproveInput })
	approveDraft(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("draftId") draftId: string,
	) {
		return this.operations.approveDraft(ctx.user.id, draftId);
	}

	@Mutation({ input: draftApproveInput })
	sendApprovedDraft(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("draftId") draftId: string,
	) {
		return this.outbound.sendApprovedDraft(ctx.user.id, draftId);
	}

	@Mutation({ input: proposalCreateInput })
	createProposal(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof proposalCreateInput>,
	) {
		return this.operations.createProposal(ctx.user.id, input);
	}

	@Mutation({ input: proofCreateInput })
	createProof(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof proofCreateInput>,
	) {
		return this.operations.createProof(ctx.user.id, input);
	}
}
