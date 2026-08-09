export type AuthenticatedPrincipal = {
	id: string;
	name: string;
	role: string;
	team: string;
	language: string;
	workingPreferences: Record<string, string | boolean>;
};

export type OwnedMailbox = {
	id: string;
	ownerUserId: string;
	address: string;
	displayName: string;
	signature: string;
};

export type IdentityEnvelope = {
	principal: { id: string; name: string };
	mailbox: { id: string; address: string; displayName: string; signature: string };
	preferences: { language: string; working: Record<string, string | boolean> };
	team: { name: string; role: string };
	crmTarget: { kind: string; id: string };
};

export function deriveIdentityEnvelope(input: {
	principal: AuthenticatedPrincipal;
	selectedMailboxId: string;
	ownedMailboxes: OwnedMailbox[];
	crmTarget: { kind: string; id: string };
	clientIdentityOverride?: unknown;
}): IdentityEnvelope {
	if (input.clientIdentityOverride !== undefined) {
		throw new Error("client identity overrides are forbidden");
	}
	const mailbox = input.ownedMailboxes.find((candidate) => candidate.id === input.selectedMailboxId);
	if (!mailbox || mailbox.ownerUserId !== input.principal.id) {
		throw new Error("mailbox does not belong to authenticated principal");
	}
	if (!input.crmTarget.kind || !input.crmTarget.id) {
		throw new Error("explicit CRM target is required");
	}
	return {
		principal: { id: input.principal.id, name: input.principal.name },
		mailbox: {
			id: mailbox.id,
			address: mailbox.address,
			displayName: mailbox.displayName,
			signature: mailbox.signature,
		},
		preferences: {
			language: input.principal.language,
			working: input.principal.workingPreferences,
		},
		team: { name: input.principal.team, role: input.principal.role },
		crmTarget: input.crmTarget,
	};
}
