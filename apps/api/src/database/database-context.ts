import { AsyncLocalStorage } from "node:async_hooks";
import { type Db, db, type Prisma } from "@crm/db";
import type { PrincipalContext } from "@crm/db/security";

type Store = { tx: Prisma.TransactionClient };

const storage = new AsyncLocalStorage<Store>();

export const contextualDatabase = new Proxy(db, {
	get(target, property, receiver) {
		const tx = storage.getStore()?.tx;
		if (!tx) {
			const value = Reflect.get(target, property, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		}
		if (property === "$transaction") {
			return async (
				input:
					| ((client: Prisma.TransactionClient) => Promise<unknown>)
					| Promise<unknown>[],
			) => (typeof input === "function" ? input(tx) : Promise.all(input));
		}
		const value = Reflect.get(tx, property, tx);
		return typeof value === "function" ? value.bind(tx) : value;
	},
}) as Db;

export async function runInPrincipalTransaction<T>(
	database: Db,
	principal: PrincipalContext,
	run: () => Promise<T>,
): Promise<T> {
	if (storage.getStore()) return run();
	return database.$transaction(async (tx) => {
		await tx.$executeRawUnsafe(
			"SELECT set_config('ibl.user_id', $1, true)",
			principal.userId ?? "",
		);
		await tx.$executeRawUnsafe(
			"SELECT set_config('ibl.mailbox_id', $1, true)",
			principal.mailboxId ?? "",
		);
		await tx.$executeRawUnsafe(
			"SELECT set_config('ibl.principal_kind', $1, true)",
			principal.kind,
		);
		return storage.run({ tx }, run);
	});
}