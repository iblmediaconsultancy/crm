import { defineConfig, env } from "../node_modules/.bun/prisma@7.9.1+5a20d2046b710dea/node_modules/prisma/config.js";

export default defineConfig({
	schema: "prisma/schema.prisma",
	migrations: { path: "prisma/migrations" },
	datasource: { url: env("PHASE0_DATABASE_URL") },
});
