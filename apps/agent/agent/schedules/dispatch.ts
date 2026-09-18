import { db } from "@crm/db";
import { defineSchedule } from "eve/schedules";
import crm from "../channels/crm";
import {
	pendingAgentRunIds,
	pendingBuilderSubmissionIds,
	queueDueAgentRuns,
} from "../lib/custom-agent-dispatch";
import { brief, drainAll, taskAuth } from "../lib/dispatch";
import {
	claimResearchRequests,
	noteResearchContinuation,
	researchRequestAuth,
	settleResearchRequest,
} from "../lib/ibl-research";
import { scheduleTask } from "../lib/tasks";

export default defineSchedule({
	cron: "* * * * *",
	async run({ receive, waitUntil, appAuth }) {
		waitUntil(
			Promise.all([
				(async () => {
					if (
						process.env.ATLAS_LIVE_OUTREACH_ENABLED?.trim().toLowerCase() !==
						"true"
					)
						return;
					const settings = await db.appSetting.findUnique({
						where: { id: "app" },
						select: { atlasLiveOutreachEnabled: true },
					});
					if (!settings?.atlasLiveOutreachEnabled) return;
					await scheduleTask({
						kind: "atlas-outreach",
						reason: "Run the Atlas autonomous outreach cycle within policy.",
						dueAt: new Date(),
						priority: 100,
						budget: 4,
					});
				})(),
				drainAll((task) =>
					receive(crm, {
						message: brief(task),
						target: { taskId: task.id },
						auth: taskAuth(task, appAuth),
					}),
				),
				(async () => {
					await queueDueAgentRuns();
					const [builderIds, runIds] = await Promise.all([
						pendingBuilderSubmissionIds(),
						pendingAgentRunIds(),
					]);

					await Promise.all([
						...builderIds.map((builderSubmissionId) =>
							receive(crm, {
								message: "Continue a queued private agent-builder chat.",
								target: { builderSubmissionId },
								auth: appAuth,
							}),
						),
						...runIds.map((runId) =>
							receive(crm, {
								message: "Execute a queued deployed agent run.",
								target: { runId },
								auth: appAuth,
							}),
						),
					]);
				})(),
				(async () => {
					const requests = await claimResearchRequests();
					await Promise.all(
						requests.map(async (request) => {
							try {
								const session = await receive(crm, {
									message: `Research request ${request.id}: ${request.prompt}`,
									target: { researchRequestId: request.id },
									auth: researchRequestAuth(request),
								});
								await noteResearchContinuation(request.id, session.id);
							} catch {
								await settleResearchRequest(
									request.id,
									"FAILED",
									"DISPATCH_FAILED",
								);
							}
						}),
					);
				})(),
			]),
		);
	},
});
