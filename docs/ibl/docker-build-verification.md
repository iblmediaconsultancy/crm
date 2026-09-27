# Docker Build Verification

Status recorded 2026-08-26 on commit `04e56e9` plus the build fix in this checkpoint.

## Cause

The application TypeScript step was not failing. A clean Linux build had no incremental compiler cache and TypeScript produced no intermediate progress output; the full check completed successfully after 115.9 seconds in the verification target and 93 seconds during the Next production build.

The apparent Docker stall was compounded by two build-context issues. The Docker context included host-generated `tsconfig.tsbuildinfo`, which is not portable incremental state. The default Dockerfile target was `verify`, whose final image retains the full source and dependency tree. The migration target had also inherited the full 2.64 GB workspace dependency layer through `FROM prisma-client`, making local image export take several minutes.

## Fix

- Exclude `**/tsconfig.tsbuildinfo` from `.dockerignore`.
- Restore the migration runtime to a filtered `bun install --filter @crm/db`, keeping Prisma migration validation intact while removing unrelated workspace dependencies from the migration image.

No typechecking, tests, schema validation, or migration validation were skipped.

## Clean build results

All targets were built with `--no-cache` from `phase1/docker/Dockerfile`:

| Target | Local immutable image ID | Approx. size |
| --- | --- | ---: |
| migrate | `sha256:2e594ab536222f655274ba1672b32ca4c2169d4c7ef36022c5e30ad4d7d9f5b2` | 837 MB |
| api | `sha256:34b9a7fc7c36742cd7e3785ce0ef686fb733f0e4dec03e5e853d635e2f335bc6` | 92.8 MB |
| worker | `sha256:6a6afb7f523257bb8f65e36ce1c7f135865e18bf82feb5fb4885c00bbb32d9e7` | 92.8 MB |
| agent | `sha256:1b181b1c45edb019e6bf625ee407217db65a4933570621c3583eda082e7c3fb7` | 87.3 MB |
| app | `sha256:4667724c906aa3177f9dfe8e99e62d7616e0cf2bc0a540dead781b31f49bc3d1` | 110.8 MB |

The base image references were resolved by Docker to immutable digests during each build. Registry publication is still required before production deployment.

## Runtime gate

- Migration container: passed; 64 migrations found, no pending migrations.
- API container: running; `/health/live` returned 200 and `/health/ready` returned 200 with `database: up`.
- App container: running; `/` returned 200.
- Agent container: running; `/` returned 200.
- Worker container: running; log reported PostgreSQL worker ready and a successful idle tick.
- Live V1, MIAB, and Resend were not contacted.
