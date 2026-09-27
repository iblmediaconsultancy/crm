# `api`

NestJS API for the CRM. Runs on Bun, backed by `@crm/db` and `@crm/auth`.

## Running it

```sh
cp .env.example .env        # at the repo root — one file for the whole monorepo
openssl rand -base64 32     # -> BETTER_AUTH_SECRET

bun run dev                 # watch mode on http://localhost:3001
bun run test
bun run build && bun run start:prod
```

The API requires `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `ALLOWED_SIGN_IN`. Public signup is disabled; users enter through an invitation or an Admin bootstrap. Google and Microsoft authentication and mailbox modules are quarantined and are not part of the V2 runtime. Provider sending credentials belong only to the PostgreSQL-backed worker. `src/config/env.validation.ts` defines the runtime groups; [`docs/environment.md`](../../docs/environment.md) explains where the file is
found.

Bun is the runtime, not just the package manager: `@crm/db` and `@crm/auth`
ship TypeScript sources, so `tsc`/`node` cannot run this app directly. `tsc` is
used for type checking only (`bun run check-types`).

## Routes

| Route            | Auth       | Notes                                         |
| ---------------- | ---------- | --------------------------------------------- |
| `/api/auth/*`    | anonymous  | Mounted by `@thallesp/nestjs-better-auth`     |
| `/auth/me`       | required   | Cached profile of the signed-in user          |
| `/auth/session`  | optional   | Whether the caller is signed in               |
| `/health`        | anonymous  | 200 with a database round-trip, 503 otherwise |

## How auth is wired

This process owns authentication. It mounts `/api/auth/*` and is the only one
that writes session cookies; the Next.js app in `apps/app` reads those sessions
straight from Postgres via `@crm/auth` and calls the routes above with
`credentials: "include"`.

`AuthModule.forRoot({ auth })` mounts the Better Auth handler and registers a
**global** `AuthGuard`, so every route is protected unless it opts out:

```ts
@Get('public')
@AllowAnonymous()          // no session required
@OptionalAuth()            // session optional; @Session() may be undefined
```

It also calls `enableCors({ origin: trustedOrigins, credentials: true })` for
the whole app, which is what lets the browser at `localhost:3000` talk to it —
`APP_URL` is the single knob for that, comma-separated if the app is served from
more than one origin.

`main.ts` creates the app with `bodyParser: false` — Better Auth needs the raw
request body, and the library installs its own parsers around the auth routes.

`AuthHooksService` uses `@AfterUpdate("user")` to drop a cached profile the
moment its row changes. Database hooks require `databaseHooks: {}` in the Better
Auth options and endpoint hooks require `hooks: {}` (both set in `@crm/auth`);
the library throws at startup without them.

## Caching

`AppCacheModule` is a bounded, per-process optimization only. PostgreSQL remains authoritative for authorization, onboarding, jobs, schedules, leases, retries, idempotency, and worker coordination. No shared cache or Redis service is required for correctness.

## Notes

- Better Auth stores rate limits in the database (`rateLimit.storage`), so every
  request to `/api/auth/*` needs a reachable Postgres. Moving this to
  `secondaryStorage` backed by Redis would remove that dependency.
- Environment variables are validated at boot by `src/config/env.validation.ts`.
  The process refuses to start on a bad config.
