import { google } from "@ai-sdk/google";
import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";

export const AGENT_MODEL: ReturnType<typeof google> = google(
	DEFAULT_AGENT_MODEL.id,
);
