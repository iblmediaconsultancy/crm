# Phase 7 deployment and operations report

Date: 2026-08-09

## Outcome

Phase 7 is complete for development handoff. The repository now contains a production-shaped app/API/worker/agent/PostgreSQL/Redis topology, one-shot migrations, least-privilege identities, file-based secret injection, health and metrics endpoints, backup/restore automation, monitoring assets, retention controls, and deployment/rollback instructions.

## Verification

- A fresh PostgreSQL 17 database accepted all 42 migrations.
- The runtime identity has no migration-ledger privileges. The backup identity is read-only, has `BYPASSRLS`, and was proved unable to insert.
- A custom-format backup passed checksum validation and restored into an isolated database with all 42 migrations present.
- The API bundle, API typecheck, agent production bundle, and Next.js 16.3 production build passed. Next generated all 27 routes under Node 22.
- API tests passed 288/288 with 616 assertions; agent tests passed 235/235 with 623 assertions.
- The V1 migration fixture suite passed 4/4 with six assertions.
- The changed implementation files pass Biome lint/assist checks. The repository-wide formatter gate remains noisy because the protected upstream tree is checked out with Windows CRLF line endings; protected files were not mass-rewritten.
- `bun audit` reports no known vulnerabilities after centrally pinning patched transitive releases.
- The regenerated inventory contains 1,151 dependency versions and zero unknown licenses.
- The load probe completed 500 requests at concurrency 25 with zero failures, 157.3 requests/second, p95 331 ms, and p99 436.1 ms.
- Key-query `EXPLAIN ANALYZE` checks used the intended indexes and completed below one millisecond on the development data set.
- Compose interpolation and all operational shell scripts passed static validation.

Machine-readable evidence is in `phase7/evidence/deployment-rehearsal.json`; the dependency inventory is in `phase7/evidence/dependency-inventory.json`.

## Environment limitation

Docker Desktop BuildKit repeatedly stopped making progress while assembling images, including with a clean 16.8 MB context and the legacy builder. The daemon was restarted and no repository source was changed by those attempts. To close the application risk independently, every build was executed against the same lockfile inside Linux containers, and app, API, and worker runtimes were exercised directly. Image assembly should be repeated by CI or a healthy Docker host before production promotion.

## External verification boundary

Production MIAB, Resend, DNS/TLS, and off-host backup credentials were not available. Protocol doubles prove TLS verification, read-only IMAP, provider gating, retry/idempotency, and sender derivation. One unauthenticated AI Gateway attempt failed before provider action; it is recorded as neither a successful external request nor provider proof.

## Verdict

The branch is deployment-ready for review and environment-specific rehearsal. Production cutover is **conditionally ready, not yet authorized** until CI assembles the images, operators inject real secrets, live MIAB/Resend smoke tests pass, off-host backup retention is confirmed, and the named release owner approves the freeze/cutover window.
