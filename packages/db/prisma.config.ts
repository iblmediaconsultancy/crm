import "@crm/env/load";

import path from "node:path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
	schema: path.join("prisma", "schema.prisma"),
	migrations: {
		path: path.join("prisma", "migrations"),
		seed: "bun run prisma/seed.ts",
	},
	datasource: {
		url: process.env.DATABASE_MIGRATION_URL ?? env("DATABASE_URL"),
		shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
	},
});
