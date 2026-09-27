import { classifyProspectBacklogRoute, db } from "../packages/db/src/index";

const filename = "IBL_Football_CRM_Master_Deduplicated_Expanded(1).xlsx";

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

async function main() {
	if (process.env.ATLAS_LIVE_OUTREACH_ENABLED !== "false") {
		throw new Error("ATLAS_LIVE_OUTREACH_ENABLED must be explicitly false");
	}
	const batch = await db.prospectSourceBatch.findFirst({
		where: { filename },
		orderBy: { importedAt: "desc" },
	});
	if (!batch) throw new Error("The workbook source batch is not loaded.");

	const routes = await db.prospectBacklogRoute.findMany({
		where: { batchId: batch.id },
		include: {
			items: {
				include: {
					item: {
						select: { displayName: true, agencyName: true, entityType: true },
					},
				},
			},
		},
	});
	const mailboxCounts = new Map<string, number>();
	const usageCounts = new Map<string, number>();
	for (const route of routes) {
		const linkedEntityKeys = strings(route.linkedEntityKeys);
		const classification = classifyProspectBacklogRoute({
			type: route.type,
			value: route.value,
			linkedEntityKeys,
			entityNames: route.items
				.filter(({ item }) => item.entityType === "PERSON")
				.map(({ item }) => item.displayName),
		});
		await db.prospectBacklogRoute.update({
			where: { id: route.id },
			data: classification,
		});
		mailboxCounts.set(
			classification.mailboxType,
			(mailboxCounts.get(classification.mailboxType) ?? 0) + 1,
		);
		usageCounts.set(
			classification.routeUsage,
			(usageCounts.get(classification.routeUsage) ?? 0) + 1,
		);
	}

	const pilots = await db.prospectBacklogPilot.findMany({
		where: { batchId: batch.id },
		include: {
			items: {
				include: {
					item: {
						select: {
							displayName: true,
							agencyName: true,
							entityType: true,
							routes: {
								include: {
									route: {
										select: { type: true, value: true, linkedEntityKeys: true },
									},
								},
							},
						},
					},
				},
			},
		},
	});
	let pilotItemsUpdated = 0;
	for (const pilot of pilots) {
		for (const pilotItem of pilot.items) {
			const route = pilotItem.item.routes.find(
				({ route }) => route.type === "EMAIL",
			)?.route;
			if (!route) continue;
			const classification = classifyProspectBacklogRoute({
				type: route.type,
				value: route.value,
				linkedEntityKeys: strings(route.linkedEntityKeys),
				entityNames:
					pilotItem.item.entityType === "PERSON"
						? [pilotItem.item.displayName]
						: [],
			});
			await db.prospectBacklogPilotItem.update({
				where: { id: pilotItem.id },
				data: {
					mailboxType: classification.mailboxType,
					mailboxTypeEvidence: classification.mailboxTypeEvidence,
					routeUsage: classification.routeUsage,
					routeVisibility:
						classification.routeUsage === "CONTACT_ONCE" ? "SHARED" : "PRIVATE",
				},
			});
			pilotItemsUpdated += 1;
		}
	}

	console.log(
		JSON.stringify(
			{
				batchId: batch.id,
				routesReclassified: routes.length,
				pilotItemsUpdated,
				mailboxTypeCounts: Object.fromEntries(mailboxCounts),
				routeUsageCounts: Object.fromEntries(usageCounts),
				liveOutreachEnabled: process.env.ATLAS_LIVE_OUTREACH_ENABLED,
			},
			null,
			2,
		),
	);
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
	});
