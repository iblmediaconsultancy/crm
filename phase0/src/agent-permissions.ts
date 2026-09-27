import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import manifest from "../agent/capabilities.json";

const allowed = new Set(manifest.allowedTools);
const forbidden = new Set(manifest.forbiddenCapabilities);

export function capabilityManifest() {
	return manifest;
}

export async function authorizeAgentCapability(databaseUrl: string, principalId: string, capability: string) {
	if (allowed.has(capability) && !forbidden.has(capability)) {
		return { allowed: true as const };
	}
	const sql = new SQL(databaseUrl);
	try {
		await sql`
			INSERT INTO phase0.agent_audit_events (id, principal_id, requested_capability, outcome, reason)
			VALUES (${randomUUID()}::uuid, ${principalId}, ${capability}, 'DENIED', 'capability absent from allowlist')
		`;
	} finally {
		await sql.close();
	}
	return { allowed: false as const, reason: "capability absent from allowlist" };
}
