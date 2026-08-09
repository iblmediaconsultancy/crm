FROM node:24.18.0-bookworm-slim AS node-runtime

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

FROM install AS prisma-client
COPY packages/db/prisma/schema.prisma packages/db/prisma/schema.prisma
RUN bun run --cwd packages/db db:generate

FROM prisma-client AS source
COPY . .
COPY --from=prisma-client /workspace/packages/db/src/generated /workspace/packages/db/src/generated
RUN node apps/api/scripts/chmod-trpc-binary.mjs
RUN bun packages/db/node_modules/prisma/build/index.js migrate diff --from-empty --to-schema packages/db/prisma/schema.prisma --script > /dev/null

FROM source AS app-build
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://phase1:phase1@127.0.0.1:1/phase1
ENV APP_URL=http://localhost:3000
ENV API_URL=http://localhost:3001
ENV BETTER_AUTH_SECRET=phase1-build-only-secret-not-production
ENV ALLOWED_SIGN_IN=local.test
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node-real
RUN node-real apps/app/node_modules/next/dist/bin/next build apps/app

FROM node-runtime AS app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /workspace
COPY --from=app-build /workspace/apps/app/.next/standalone ./
COPY --from=app-build /workspace/apps/app/.next/static ./apps/app/.next/static
COPY --from=app-build /workspace/apps/app/public ./apps/app/public
EXPOSE 3000
CMD ["node", "apps/app/server.js"]

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
CMD ["bun", "packages/db/node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "packages/db/prisma.config.ts"]

FROM source AS verify
RUN bun test apps/app/test/onboarding-gate.spec.ts
RUN bun run --cwd apps/app typegen && bun run --cwd apps/app check-types
