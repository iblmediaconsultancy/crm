import { db } from "@crm/db";
import { TlsMiabProtocolClient } from "../src/providers/miab-imap.client";
import { MiabSentSyncService } from "../src/providers/miab-sent-sync.service";
import { EnvironmentMiabCredentialSource } from "../src/providers/provider-credentials";

const idempotencyKeys = [
	"atlas-live-20260921-unique-mikey-moore",
	"atlas-live-20260921-bestofyou-manuel-angel",
	"atlas-live-20260921-tenet-deniz-undav",
	"atlas-live-20260921-caa-base-cole-palmer",
	"atlas-live-20260921-goal-management-seydou-fall",
];

async function main() {
	const deliveries = await db.outboundDelivery.findMany({
		where: {
			draft: { idempotencyKey: { in: idempotencyKeys } },
			status: { in: ["SENT", "DELIVERED", "REPLIED"] },
		},
		select: { id: true },
	});
	const marked = await db.outboundDelivery.updateMany({
		where: { id: { in: deliveries.map((delivery) => delivery.id) } },
		data: {
			sentSyncStatus: "PENDING",
			sentSyncRetryAt: null,
			sentSyncErrorCode: null,
			sentSyncLeaseOwner: null,
			sentSyncLeasedUntil: null,
		},
	});
	const service = new MiabSentSyncService(
		db,
		new EnvironmentMiabCredentialSource(),
		() => new TlsMiabProtocolClient(),
	);
	let processed = 0;
	while (await service.runNext(`sent-backfill:${process.pid}`)) processed += 1;
	const result = await db.outboundDelivery.findMany({
		where: { id: { in: deliveries.map((delivery) => delivery.id) } },
		select: {
			id: true,
			sentSyncStatus: true,
			sentSyncFolder: true,
			sentSyncUid: true,
			sentSyncAttempts: true,
			sentSyncErrorCode: true,
			draft: { select: { idempotencyKey: true } },
		},
		orderBy: { createdAt: "asc" },
	});
	console.log(
		JSON.stringify({ marked: marked.count, processed, result }, null, 2),
	);
}

await main().finally(() => db.$disconnect());
