import { z } from "zod";

const id = z.string().trim().min(1).max(191);
const optionalId = id.nullable().optional();

export const operationsListInput = z.object({
	q: z.string().trim().max(200).default(""),
	take: z.number().int().min(1).max(100).default(50),
	skip: z.number().int().min(0).max(10000).default(0),
});

export const footballProfileInput = z.object({
	contactId: id,
	kind: z.enum(["PLAYER", "FOOTBALL_AGENT"]),
	nationality: z.string().trim().max(100).nullable().optional(),
	position: z.string().trim().max(100).nullable().optional(),
	preferredFoot: z.string().trim().max(30).nullable().optional(),
	agencyId: optionalId,
	licenseNumber: z.string().trim().max(100).nullable().optional(),
	licenseCountry: z.string().trim().max(100).nullable().optional(),
});

export const organizationProfileInput = z.object({
	companyId: id,
	kind: z.enum(["AGENCY", "CLUB"]),
	registrationId: z.string().trim().max(100).nullable().optional(),
	jurisdiction: z.string().trim().max(100).nullable().optional(),
	association: z.string().trim().max(100).nullable().optional(),
	league: z.string().trim().max(100).nullable().optional(),
	countryCode: z.string().trim().max(3).nullable().optional(),
});

export const representationCreateInput = z.object({
	playerContactId: id,
	agentContactId: id,
	agencyCompanyId: optionalId,
	status: z.enum(["PENDING", "ACTIVE"]).default("PENDING"),
	startedAt: z.string().datetime().nullable().optional(),
	reason: z.string().trim().max(1000).nullable().optional(),
});

export const representationTransitionInput = z.object({
	id,
	status: z.enum(["PENDING", "ACTIVE", "FORMER", "DISPUTED"]),
	reason: z.string().trim().min(1).max(1000),
});

export const contactRouteCreateInput = z.object({
	contactId: optionalId,
	companyId: optionalId,
	type: z.enum(["EMAIL", "PHONE", "WHATSAPP", "LINKEDIN", "SOCIAL", "OTHER"]),
	value: z.string().trim().min(1).max(500),
	label: z.string().trim().max(100).nullable().optional(),
	visibility: z.enum(["PRIVATE", "SHARED"]).default("PRIVATE"),
});

export const contactRouteShareInput = z.object({
	routeId: id,
	granteeContactId: optionalId,
	granteeCompanyId: optionalId,
	useForResearch: z.boolean().default(true),
	useForOutreach: z.boolean().default(false),
	reason: z.string().trim().min(1).max(1000),
});

export const leadCreateInput = z.object({
	name: z.string().trim().min(1).max(200),
	contactId: optionalId,
	companyId: optionalId,
	dealId: optionalId,
	ownerUserId: id,
	nextActionAt: z.string().datetime().nullable().optional(),
});

export const taskCreateInput = z.object({
	title: z.string().trim().min(1).max(200),
	description: z.string().trim().max(2000).nullable().optional(),
	priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
	assigneeUserId: id,
	companyId: optionalId,
	contactId: optionalId,
	leadId: optionalId,
	dealId: optionalId,
	dueAt: z.string().datetime().nullable().optional(),
	reminderAt: z.string().datetime().nullable().optional(),
	idempotencyKey: z.string().trim().max(191).nullable().optional(),
});

export const taskTransitionInput = z.object({
	id,
	status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]),
});

export const noteCreateInput = z.object({
	body: z.string().trim().min(1).max(10000),
	companyId: optionalId,
	contactId: optionalId,
	leadId: optionalId,
	dealId: optionalId,
});

export const assignmentCreateInput = z.object({
	entityType: z.enum([
		"COMPANY",
		"CONTACT",
		"PLAYER",
		"FOOTBALL_AGENT",
		"AGENCY",
		"CLUB",
		"REPRESENTATION",
		"LEAD",
		"DEAL",
		"TASK",
		"NOTE",
		"PROOF_ITEM",
		"TEMPLATE",
		"DRAFT",
		"PROPOSAL",
		"OUTREACH",
		"RESEARCH_REQUEST",
	]),
	entityId: id,
	assigneeUserId: id,
	reason: z.string().trim().min(1).max(1000),
});

export const researchRequestCreateInput = z.object({
	mailboxId: optionalId,
	targetType: assignmentCreateInput.shape.entityType,
	targetEntityId: id,
	prompt: z.string().trim().min(1).max(10000),
	idempotencyKey: id,
});

export const templateCreateInput = z.object({
	name: z.string().trim().min(1).max(200),
	kind: z.enum(["EMAIL", "PROPOSAL", "RESEARCH", "FOLLOW_UP"]),
	subject: z.string().trim().max(500).nullable().optional(),
	body: z.string().trim().min(1).max(50000),
	shared: z.boolean().default(false),
});

export const draftCreateInput = z.object({
	mailboxId: optionalId,
	recipientRouteId: optionalId,
	templateId: optionalId,
	subject: z.string().trim().max(500).nullable().optional(),
	body: z.string().trim().min(1).max(50000),
	idempotencyKey: id,
});

export const approvalRequestInput = z.object({
	draftId: id,
	idempotencyKey: id,
});

export const approvalDecisionInput = z.object({
	id,
	status: z.enum(["APPROVED", "REJECTED"]),
	reason: z.string().trim().min(1).max(2000),
});

export const draftApproveInput = z.object({ draftId: id });

export const proposalCreateInput = z.object({
	title: z.string().trim().min(1).max(200),
	summary: z.string().trim().max(5000).nullable().optional(),
	leadId: optionalId,
	dealId: optionalId,
	draftId: optionalId,
	content: z.record(z.string(), z.unknown()),
	items: z
		.array(
			z.object({
				label: z.string().trim().min(1).max(200),
				description: z.string().trim().max(2000).nullable().optional(),
				quantity: z.number().nonnegative().nullable().optional(),
				unitAmount: z.number().nonnegative().nullable().optional(),
				currency: z.string().trim().length(3).nullable().optional(),
			}),
		)
		.max(100)
		.default([]),
});

export const proofCreateInput = z.object({
	label: z.string().trim().min(1).max(200),
	proofType: z.string().trim().min(1).max(100),
	reference: z.string().trim().max(2000).nullable().optional(),
	companyId: optionalId,
	contactId: optionalId,
	leadId: optionalId,
	dealId: optionalId,
	evidenceSourceId: optionalId,
});

export type OperationsListInput = z.infer<typeof operationsListInput>;
