import { SQL } from "bun";

export type RequestPrincipal =
	| { type: "user"; userId: string }
	| { type: "worker"; mailboxId: string }
	| { type: "unscoped" };

export function authorizeMailboxAtRepository(input: {
	principal: RequestPrincipal;
	mailbox: { id: string; ownerUserId: string };
	readGrantUserIds: string[];
}) {
	if (input.principal.type === "worker") return input.principal.mailboxId === input.mailbox.id;
	if (input.principal.type !== "user") return false;
	return input.mailbox.ownerUserId === input.principal.userId || input.readGrantUserIds.includes(input.principal.userId);
}

export async function readMailboxMessages(databaseUrl: string, principal: RequestPrincipal) {
	const sql = new SQL(databaseUrl);
	try {
		return await sql.begin(async (tx) => {
			await tx`SET LOCAL ROLE ibl_phase0_app`;
			await tx`SELECT set_config('phase0.principal_type', ${principal.type}, true)`;
			await tx`SELECT set_config('phase0.user_id', ${principal.type === "user" ? principal.userId : ""}, true)`;
			await tx`SELECT set_config('phase0.mailbox_id', ${principal.type === "worker" ? principal.mailboxId : ""}, true)`;
			return tx<Array<{ mailbox_id: string; message_id: string; body: string }>>`
				SELECT t.mailbox_id::text, m.message_id, m.body
				FROM phase0.email_messages m
				JOIN phase0.email_threads t ON t.id = m.thread_id
				ORDER BY m.message_id
			`;
		});
	} finally {
		await sql.close();
	}
}

export async function listMailboxes(databaseUrl: string, principal: RequestPrincipal) {
	const sql = new SQL(databaseUrl);
	try {
		return await sql.begin(async (tx) => {
			await tx`SET LOCAL ROLE ibl_phase0_app`;
			await tx`SELECT set_config('phase0.principal_type', ${principal.type}, true)`;
			await tx`SELECT set_config('phase0.user_id', ${principal.type === "user" ? principal.userId : ""}, true)`;
			await tx`SELECT set_config('phase0.mailbox_id', ${principal.type === "worker" ? principal.mailboxId : ""}, true)`;
			return tx<Array<{ id: string; address: string }>>`SELECT id::text, address FROM phase0.mailboxes ORDER BY address`;
		});
	} finally {
		await sql.close();
	}
}
