import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bridge } from "../agent/bridge";
import { resolveAtlasOutreachSender } from "./atlas-sender";
import { EnvironmentResendCredentialSource } from "./provider-credentials";

export type AtlasPostgresWorkerReadiness = "READY" | "UNAVAILABLE" | "STALE";

export type AtlasRuntimeReadiness = {
	bridge: "READY" | "UNCONFIGURED" | "UNREACHABLE";
	postgresWorker: AtlasPostgresWorkerReadiness;
	provider: "READY" | "BLOCKED";
	providerReason: string | null;
};

export type AtlasSystemReadinessState = {
	operatorKind: string | null;
	mailbox: {
		ownerUserId: string;
		address: string;
		status: string;
	} | null;
	providerCapabilityStatus: string | null;
	crmLiveOutreachEnabled: boolean;
	authorization: { id: string; expiresAt: Date | null } | null;
};

export function classifyPostgresWorkerHeartbeat(
	lastModifiedMs: number | null,
	nowMs = Date.now(),
	staleAfterMs = 15_000,
): AtlasPostgresWorkerReadiness {
	if (lastModifiedMs === null) return "UNAVAILABLE";
	return nowMs - lastModifiedMs <= staleAfterMs ? "READY" : "STALE";
}

export function evaluateAtlasSystemReadiness(
	state: AtlasSystemReadinessState,
	runtime: AtlasRuntimeReadiness,
	environmentLiveOutreachEnabled: boolean,
) {
	const blockers: string[] = [];
	const systemOperatorReady = state.operatorKind === "SYSTEM_OPERATOR";
	const mailboxReady = Boolean(
		systemOperatorReady &&
			state.mailbox?.ownerUserId === "atlas-operator" &&
			state.mailbox.address.toLowerCase() === "outreach@iblmedia.com" &&
			state.mailbox.status === "VERIFIED",
	);
	const providerReady =
		state.providerCapabilityStatus === "VERIFIED" &&
		runtime.provider === "READY";
	if (!systemOperatorReady) blockers.push("ATLAS_SYSTEM_OPERATOR_UNAVAILABLE");
	if (!mailboxReady) blockers.push("ATLAS_SYSTEM_MAILBOX_UNVERIFIED");
	if (state.providerCapabilityStatus !== "VERIFIED")
		blockers.push("RESEND_OUTBOUND_UNVERIFIED");
	if (runtime.provider !== "READY")
		blockers.push(runtime.providerReason ?? "RESEND_CONFIGURATION_UNAVAILABLE");
	if (runtime.postgresWorker !== "READY")
		blockers.push(`OUTBOUND_WORKER_${runtime.postgresWorker}`);
	if (runtime.bridge !== "READY")
		blockers.push(`AGENT_BRIDGE_${runtime.bridge}`);
	if (!state.authorization) blockers.push("OUTREACH_AUTHORIZATION_REQUIRED");
	if (!state.crmLiveOutreachEnabled)
		blockers.push("CRM_LIVE_OUTREACH_DISABLED");
	if (!environmentLiveOutreachEnabled)
		blockers.push("ENV_LIVE_OUTREACH_DISABLED");
	return {
		status: blockers.length === 0 ? ("READY" as const) : ("BLOCKED" as const),
		mailbox: {
			status: mailboxReady ? ("READY" as const) : ("UNCONFIGURED" as const),
			address: state.mailbox?.address ?? "outreach@iblmedia.com",
			owner: systemOperatorReady
				? ("ATLAS_SYSTEM_OPERATOR" as const)
				: ("UNAVAILABLE" as const),
		},
		provider: providerReady ? ("READY" as const) : ("BLOCKED" as const),
		bridge: runtime.bridge,
		postgresWorker: runtime.postgresWorker,
		authorization: state.authorization
			? { status: "ACTIVE" as const, expiresAt: state.authorization.expiresAt }
			: { status: "REQUIRED" as const, expiresAt: null },
		liveOutreach:
			state.crmLiveOutreachEnabled && environmentLiveOutreachEnabled
				? ("ENABLED" as const)
				: ("DISABLED" as const),
		blockers,
	};
}

export async function atlasRuntimeReadiness(): Promise<AtlasRuntimeReadiness> {
	const configuredBridge = bridge();
	let bridgeStatus: AtlasRuntimeReadiness["bridge"] = "UNCONFIGURED";
	if (configuredBridge) {
		try {
			const response = await fetch(
				configuredBridge.url("/internal/crm/readiness"),
				{
					method: "POST",
					headers: { authorization: `Bearer ${configuredBridge.secret}` },
					signal: AbortSignal.timeout(2_000),
				},
			);
			bridgeStatus = response.status === 204 ? "READY" : "UNREACHABLE";
		} catch {
			bridgeStatus = "UNREACHABLE";
		}
	}

	let providerReason: string | null = null;
	try {
		resolveAtlasOutreachSender();
		await new EnvironmentResendCredentialSource().load();
	} catch (error) {
		providerReason =
			error instanceof Error ? error.message : "PROVIDER_UNAVAILABLE";
	}
	let workerModifiedAt: number | null = null;
	try {
		workerModifiedAt = (await stat(join(tmpdir(), "worker-ready"))).mtimeMs;
	} catch {}

	return {
		bridge: bridgeStatus,
		postgresWorker: classifyPostgresWorkerHeartbeat(workerModifiedAt),
		provider: providerReason ? "BLOCKED" : "READY",
		providerReason,
	};
}
