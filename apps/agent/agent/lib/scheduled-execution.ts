export const SCHEDULED_EXECUTION_ENV = "ATLAS_SCHEDULED_EXECUTION_ENABLED";

export function isScheduledExecutionEnabled(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return env[SCHEDULED_EXECUTION_ENV]?.trim().toLowerCase() === "true";
}
