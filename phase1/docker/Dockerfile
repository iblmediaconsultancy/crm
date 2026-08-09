FROM oven/bun:1.3.12 AS install
WORKDIR /workspace
COPY package.json bun.lock ./
COPY apps/app/package.json apps/app/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/telemetry/package.json packages/telemetry/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN bun install --frozen-lockfile --ignore-scripts

FROM install AS source
COPY . .
RUN node apps/api/scripts/chmod-trpc-binary.mjs && bunx prisma generate --schema packages/db/prisma/schema.prisma

FROM node:24.18.0-bookworm-slim AS app-build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /workspace
COPY --from=source /workspace .
RUN node node_modules/next/dist/bin/next build apps/app

FROM node:24.18.0-bookworm-slim AS app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /workspace
COPY --from=app-build /workspace .
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "apps/app", "-p", "3000"]

FROM source AS api-build
RUN bun run --cwd apps/api build

FROM oven/bun:1.3.12 AS api
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=api-build /workspace .
EXPOSE 3001
CMD ["bun", "apps/api/dist/main.js"]

FROM source AS agent
ENV NODE_ENV=development
WORKDIR /workspace
EXPOSE 2000
CMD ["bun", "run", "--cwd", "apps/agent", "dev:headless"]

FROM source AS migrate
WORKDIR /workspace
CMD ["bunx", "prisma", "migrate", "deploy", "--config", "packages/db/prisma.config.ts"]
