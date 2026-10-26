import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import type { LinkedInActionQueueService } from "../src/linkedin/linkedin-action-queue.service";
import { LinkedInManualService } from "../src/linkedin/linkedin-manual.service";

function manualAction() {
	return {
		id: "manual-action-1",
		contactId: "contact-1",
		routeId: "route-1",
		conversationId: "conversation-1",
		type: "REPLY",
		status: "PREPARED",
		profileUrl: "https://www.linkedin.com/in/example-person/",
		linkedinMemberIdentifier: "ACoAExampleMember",
		body: "Prepared reply",
		whyNow: "A relevant inbound message needs a response.",
		contact: {
			id: "contact-1",
			firstName: "Example",
			lastName: "Person",
			companyId: "company-1",
			outreachState: "ALLOWED",
			lifecycleState: "ACTIVE",
			company: { name: "Example Agency" },
		},
		route: {
			value: "https://www.linkedin.com/in/example-person/",
			linkedinMemberIdentifier: "ACoAExampleMember",
			linkedinRelationshipState: "CONNECTED",
			linkedinRelationshipVerifiedAt: new Date("2026-10-26T10:00:00Z"),
		},
		conversation: {
			id: "conversation-1",
			profileUrl: "https://www.linkedin.com/in/example-person/",
			normalizedProfileUrl: "example-person",
			linkedinMemberIdentifier: "ACoAExampleMember",
			externalConversationKey: "thread-1",
			status: "ACTIVE",
			classification: "ACTIVE_HUMAN_CONVERSATION",
			consent: "UNKNOWN",
			connectionState: "CONNECTED",
			messages: [],
		},
	};
}

function serviceFixture(
	input: {
		personProtection?: { id: string } | null;
		organizationProtection?: { id: string } | null;
		suppressions?: Array<{ scope: string; channel: string | null }>;
		claim?: {
			channel: string;
			status: string;
			claimedAt: Date;
			consumedAt: Date | null;
			releasedAt: Date | null;
		} | null;
	} = {},
) {
	const calls: Array<{ model: string; args?: unknown }> = [];
	const action = manualAction();
	const tx = {
		$executeRaw: async () => 1,
		linkedInManualAction: {
			findMany: async () => [action],
		},
		linkedInConversation: {
			findMany: async () => [],
		},
		personProtection: {
			findFirst: async (args: unknown) => {
				calls.push({ model: "personProtection", args });
				return input.personProtection ?? null;
			},
		},
		organizationProtection: {
			findFirst: async (args: unknown) => {
				calls.push({ model: "organizationProtection", args });
				return input.organizationProtection ?? null;
			},
		},
		outreachSuppression: {
			findMany: async (args: unknown) => {
				calls.push({ model: "outreachSuppression", args });
				return input.suppressions ?? [];
			},
		},
		relationshipColdTouchClaim: {
			findUnique: async (args: unknown) => {
				calls.push({ model: "relationshipColdTouchClaim", args });
				return input.claim ?? null;
			},
		},
	};
	const db = {
		$transaction: async <T>(run: (client: typeof tx) => Promise<T>) => run(tx),
	} as unknown as Db;
	const service = new LinkedInManualService(
		db,
		{} as LinkedInActionQueueService,
	);
	return { service, calls };
}

describe("LinkedIn manual list safety summary", () => {
	it("returns read-only identity, conversation, protection, suppression and CONTACT_ONCE state", async () => {
		const claimedAt = new Date("2026-10-25T10:00:00Z");
		const { service, calls } = serviceFixture({
			personProtection: { id: "protection-1" },
			organizationProtection: { id: "organization-protection-1" },
			suppressions: [
				{ scope: "CONTACT", channel: null },
				{ scope: "ROUTE", channel: "LINKEDIN" },
			],
			claim: {
				channel: "LINKEDIN",
				status: "CLAIMED",
				claimedAt,
				consumedAt: null,
				releasedAt: null,
			},
		});

		const result = await service.list("user-1", { limit: 1 });
		expect(result.actions).toHaveLength(1);
		expect(result.actions[0]).toMatchObject({
			id: "manual-action-1",
			contactId: "contact-1",
			routeId: "route-1",
			conversationId: "conversation-1",
			status: "PREPARED",
			conversation: {
				id: "conversation-1",
				profileUrl: "https://www.linkedin.com/in/example-person/",
				linkedinMemberIdentifier: "ACoAExampleMember",
				externalConversationKey: "thread-1",
				connectionState: "CONNECTED",
			},
			safety: {
				contactOutreachState: "ALLOWED",
				contactLifecycleState: "ACTIVE",
				personProtected: true,
				organizationProtected: true,
				suppressionPresent: true,
				suppressionScopes: [
					{ scope: "CONTACT", channel: null },
					{ scope: "ROUTE", channel: "LINKEDIN" },
				],
				contactOnceClaim: {
					channel: "LINKEDIN",
					status: "CLAIMED",
					claimedAt,
				},
			},
		});
		expect(calls.map(({ model }) => model).sort()).toEqual([
			"organizationProtection",
			"outreachSuppression",
			"personProtection",
			"relationshipColdTouchClaim",
		]);
	});

	it("reports clear state without inventing a CONTACT_ONCE claim", async () => {
		const { service } = serviceFixture();
		const result = await service.list("user-1", { limit: 1 });
		expect(result.actions[0]?.safety).toMatchObject({
			personProtected: false,
			organizationProtected: false,
			suppressionPresent: false,
			suppressionScopes: [],
			contactOnceClaim: null,
		});
	});
});
