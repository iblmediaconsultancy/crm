import type { Prisma } from "./generated/prisma/client";

export const PERSON_OWNER_PROTECTED = "PERSON_OWNER_PROTECTED" as const;
export const MANUAL_IHSAN = "MANUAL_IHSAN" as const;

export function manualPersonProtectionActorAllowed(input: {
	role: "admin" | "team" | "contributor";
	kind: "HUMAN" | "SYSTEM_OPERATOR";
}): boolean {
	return input.kind === "HUMAN" && input.role !== "contributor";
}

export type PersonProtectionReadClient = Pick<
	Prisma.TransactionClient,
	"personProtection"
>;

export async function activePersonProtection(
	client: PersonProtectionReadClient,
	contactId: string,
) {
	return client.personProtection.findFirst({
		where: { contactId, status: "ACTIVE" },
		orderBy: { protectedAt: "desc" },
	});
}

export async function isPersonProtected(
	client: PersonProtectionReadClient,
	contactId: string,
): Promise<boolean> {
	return Boolean(
		await client.personProtection.findFirst({
			where: { contactId, status: "ACTIVE" },
			select: { id: true },
		}),
	);
}

export function personProtectionBlockReason(
	protectedContact: boolean,
): typeof PERSON_OWNER_PROTECTED | null {
	return protectedContact ? PERSON_OWNER_PROTECTED : null;
}
