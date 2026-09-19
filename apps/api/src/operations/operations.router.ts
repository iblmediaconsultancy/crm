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
import { PermissionMiddleware } from "../trpc/middlewares/permission.middleware";
import {
	approvalDecisionInput,
	approvalRequestInput,
	assignmentCreateInput,
	contactRouteCreateInput,
	contactRouteShareInput,
	draftApproveInput,
	draftCreateInput,
	draftUpdateInput,
	footballProfileInput,
	leadCreateInput,
	leadHandoffInput,
	leadIdInput,
	leadTransitionInput,
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
@UseMiddlewares(AuthMiddleware, PermissionMiddleware)
export class OperationsRouter {
	constructor(
		@Inject(OperationsService) private readonly operations: OperationsService,
		@Inject(OutboundDeliveryService)
		private readonly outbound: OutboundDeliveryService,
	) {}

	@Query({ meta: { permission: "crm.read" } })
	overview(@Ctx() ctx: AuthedTrpcContext) {
		return this.operations.overview(ctx.user.id);
	}

	@Query({ meta: { permission: "crm.read" } })
	outreachWorkspace(@Ctx() ctx: AuthedTrpcContext) {
		return this.operations.outreachWorkspace(ctx.user.id);
	}

	@Query({ input: operationsListInput, meta: { permission: "crm.read" } })
	selectors(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof operationsListInput>,
	) {
		return this.operations.selectors(ctx.user.id, input);
	}

	@Query({ input: leadIdInput, meta: { permission: "crm.read" } })
	leadById(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof leadIdInput>,
	) {
		return this.operations.leadById(ctx.user.id, input.id);
	}
	@Query({ input: operationsListInput, meta: { permission: "crm.read" } })
	directory(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof operationsListInput>,
	) {
		return this.operations.directory(ctx.user.id, input);
	}

	@Query({ input: operationsListInput, meta: { permission: "crm.read" } })
	workbench(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof operationsListInput>,
	) {
		return this.operations.workbench(ctx.user.id, input);
	}

	@Mutation({
		input: footballProfileInput,
		meta: { permission: "football.manage" },
	})
	saveFootballProfile(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof footballProfileInput>,
	) {
		return this.operations.saveFootballProfile(ctx.user.id, input);
	}

	@Mutation({
		input: organizationProfileInput,
		meta: { permission: "football.manage" },
	})
	saveOrganizationProfile(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof organizationProfileInput>,
	) {
		return this.operations.saveOrganizationProfile(ctx.user.id, input);
	}

	@Mutation({
		input: representationCreateInput,
		meta: { permission: "football.manage" },
	})
	createRepresentation(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof representationCreateInput>,
	) {
		return this.operations.createRepresentation(ctx.user.id, input);
	}

	@Mutation({
		input: representationTransitionInput,
		meta: { permission: "football.manage" },
	})
	transitionRepresentation(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof representationTransitionInput>,
	) {
		return this.operations.transitionRepresentation(ctx.user.id, input);
	}

	@Mutation({
		input: contactRouteCreateInput,
		meta: { permission: "crm.create" },
	})
	createRoute(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof contactRouteCreateInput>,
	) {
		return this.operations.createRoute(ctx.user.id, input);
	}

	@Mutation({
		input: contactRouteShareInput,
		meta: { permission: "football.manage" },
	})
	shareRoute(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof contactRouteShareInput>,
	) {
		return this.operations.shareRoute(ctx.user.id, input);
	}

	@Mutation({ input: leadCreateInput, meta: { permission: "crm.create" } })
	createLead(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof leadCreateInput>,
	) {
		return this.operations.createLead(ctx.user.id, input);
	}

	@Mutation({
		input: leadTransitionInput,
		meta: { permission: "crm.update.owned" },
	})
	transitionLead(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof leadTransitionInput>,
	) {
		return this.operations.transitionLead(ctx.user.id, input);
	}

	@Mutation({
		input: leadHandoffInput,
		meta: { permission: "crm.update.owned" },
	})
	handoffLead(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof leadHandoffInput>,
	) {
		return this.operations.handoffLead(ctx.user.id, input);
	}

	@Mutation({ input: taskCreateInput, meta: { permission: "crm.create" } })
	createTask(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof taskCreateInput>,
	) {
		return this.operations.createTask(ctx.user.id, input);
	}

	@Mutation({
		input: taskTransitionInput,
		meta: { permission: "crm.update.owned" },
	})
	transitionTask(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof taskTransitionInput>,
	) {
		return this.operations.transitionTask(ctx.user.id, input);
	}

	@Mutation({ input: noteCreateInput, meta: { permission: "crm.create" } })
	createNote(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof noteCreateInput>,
	) {
		return this.operations.createNote(ctx.user.id, input);
	}

	@Mutation({
		input: assignmentCreateInput,
		meta: { permission: "allocation.manage" },
	})
	assign(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof assignmentCreateInput>,
	) {
		return this.operations.assign(ctx.user.id, input);
	}

	@Mutation({
		input: researchRequestCreateInput,
		meta: { permission: "crm.create" },
	})
	requestResearch(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof researchRequestCreateInput>,
	) {
		return this.operations.requestResearch(ctx.user.id, input);
	}

	@Mutation({ input: templateCreateInput, meta: { permission: "crm.create" } })
	createTemplate(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof templateCreateInput>,
	) {
		return this.operations.createTemplate(ctx.user.id, input);
	}

	@Mutation({ input: draftCreateInput, meta: { permission: "crm.create" } })
	createDraft(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof draftCreateInput>,
	) {
		return this.operations.createDraft(ctx.user.id, input);
	}

	@Mutation({
		input: draftUpdateInput,
		meta: { permission: "crm.update.owned" },
	})
	updateDraft(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof draftUpdateInput>,
	) {
		return this.operations.updateDraft(ctx.user.id, input);
	}

	@Mutation({ input: approvalRequestInput, meta: { permission: "crm.create" } })
	requestApproval(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof approvalRequestInput>,
	) {
		return this.operations.requestApproval(ctx.user.id, input);
	}

	@Mutation({
		input: approvalDecisionInput,
		meta: { permission: "outreach.approve" },
	})
	decideApproval(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof approvalDecisionInput>,
	) {
		return this.operations.decideApproval(ctx.user.id, input);
	}

	@Mutation({ input: draftApproveInput, meta: { permission: "crm.create" } })
	sendApprovedDraft(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("draftId") draftId: string,
	) {
		return this.outbound.queueApprovedDraft(ctx.user.id, draftId);
	}

	@Mutation({ input: proposalCreateInput, meta: { permission: "crm.create" } })
	createProposal(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof proposalCreateInput>,
	) {
		return this.operations.createProposal(ctx.user.id, input);
	}

	@Mutation({ input: proofCreateInput, meta: { permission: "crm.create" } })
	createProof(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof proofCreateInput>,
	) {
		return this.operations.createProof(ctx.user.id, input);
	}
}
