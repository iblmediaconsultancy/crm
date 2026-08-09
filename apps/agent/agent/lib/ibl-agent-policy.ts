import { db } from "@crm/db";
import {
	deriveAuthenticatedIdentity,
	type IdentityEnvelope,
	withPrincipal,
} from "@crm/db/security";
import type { PurposeContext } from "./session-purpose";
import {
	assertResearchPurpose,
	attribute,
	requireAttribute,
} from "./session-purpose";

export const AGENT_CAPABILITIES = [
	"read.identity",
	"read.research",
	"research.evidence",
	"research.finding",
	"proposal.draft",
	"proposal.create",
	"proposal.review",
] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export type IblAgentIdentity = {
	envelope: IdentityEnvelope;
	researchRequestId: string;
};

export async function requireIblAgentIdentity(
	ctx: PurposeContext,
	capability: string,
): Promise<IblAgentIdentity> {
	assertResearchPurpose(ctx);
	const userId = requireAttribute(ctx, "userId");
	if (!AGENT_CAPABILITIES.includes(capability as AgentCapability)) {
		await auditDeniedCapability(userId, capability);
		throw new Error(`Agent capability ${capability} is denied by policy.`);
	}

	const researchRequestId = requireAttribute(ctx, "researchRequestId");
	const mailboxId = attribute(ctx, "mailboxId");
	const targetType = requireAttribute(ctx, "targetType");
	const targetEntityId = requireAttribute(ctx, "targetEntityId");
	const envelope = await deriveAuthenticatedIdentity(db, {
		userId,
		mailboxId,
		crmTarget: { kind: targetType, id: targetEntityId },
	});
	const scoped = await withPrincipal(
		db,
		{ userId, mailboxId, kind: "user" },
		(tx) =>
			tx.researchRequest.findFirst({
				where: {
					id: researchRequestId,
					ownerUserId: userId,
					mailboxId: mailboxId ?? null,
					targetType: targetType as never,
					targetEntityId,
				},
				select: { id: true },
			}),
	);
	if (!scoped) {
		await db.securityAuditEvent.create({
			data: {
				actorUserId: userId,
				action: "AGENT_IDENTITY_SCOPE_DENIED",
				resourceType: "ResearchRequest",
				resourceId: researchRequestId,
				outcome: "DENIED",
				metadata: { capability, mailboxContext: Boolean(mailboxId) },
			},
		});
		throw new Error("Research request is outside this identity envelope.");
	}

	return { envelope, researchRequestId };
}

export async function auditDeniedCapability(
	claimedUserId: string | null,
	capability: string,
): Promise<void> {
	const actor = claimedUserId
		? await db.user.findUnique({
				where: { id: claimedUserId },
				select: { id: true },
			})
		: null;
	await db.securityAuditEvent.create({
		data: {
			actorUserId: actor?.id,
			action: "AGENT_CAPABILITY_DENIED",
			resourceType: "AgentCapability",
			resourceId: capability.slice(0, 191),
			outcome: "DENIED",
			metadata: { source: "eve", defaultPolicy: "deny" },
		},
	});
}
