import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";
import { agentError, modelError } from "@crm/telemetry";
import { defineHook } from "eve/hooks";

const MODEL_CODES = [
	"model",
	"provider",
	"rate_limit",
	"context_length",
	"overloaded",
	"unauthorized",
	"quota",
	"resource_exhausted",
];

function taskKind(
	auth: { attributes?: Record<string, unknown> } | null,
): string | null {
	const kind = auth?.attributes?.taskKind;
	return typeof kind === "string" && kind.trim() ? kind.trim() : null;
}

function looksLikeModel(code: string): boolean {
	const lowered = code.toLowerCase();
	return MODEL_CODES.some((marker) => lowered.includes(marker));
}

export default defineHook({
	events: {
		"action.result"(event, ctx) {
			const { error, result, status } = event.data;
			if (status === "completed") return;

			agentError({
				error: error ?? status,
				tool: "toolName" in result ? result.toolName : null,
				taskKind: taskKind(ctx.session.auth.current ?? null),
				source: "tool",
			});
		},

		"turn.failed"(event, ctx) {
			agentError({
				error: event.data.code,
				taskKind: taskKind(ctx.session.auth.current ?? null),
				source: "turn",
			});
		},

		"session.failed"(event, ctx) {
			agentError({
				error: event.data.code,
				taskKind: taskKind(ctx.session.auth.current ?? null),
				source: "session",
			});
		},

		async "step.failed"(event) {
			if (!looksLikeModel(event.data.code)) return;

			modelError({
				error: event.data.code,
				modelId: DEFAULT_AGENT_MODEL.id,
			});
		},
	},
});
