# V1 to V2 migration

The migration is dry-run first and reads V1 through a dedicated read-only
connection. Raw exports are written under `phase6/artifacts/`, which is ignored
because those files may contain personal or mailbox data. Only redacted counts,
checksums, reason codes, and hashed source identifiers are emitted in reports.

Required environment variables:

- `V1_DATABASE_URL`: read-only connection to the authorized V1 development Supabase database.
- `DATABASE_URL`: migration-owner V2 connection; required only for `apply` and database reconciliation.
- `V2_OWNER_USER_ID`: an existing V2 user that owns imported CRM rows.

Commands are `bun run migration:v1:inventory`, `export`, `plan`, `apply`, and
`reconcile`. Sanitized fixture verification uses `fixture-apply` and
`fixture-reconcile`. `apply` refuses to run unless `--confirm-apply` is present. Exports
use a repeatable-read, read-only transaction and record its transaction,
database-snapshot, and capture-time watermarks. The operational safety layer
creates deterministic SHA-256 fingerprints for source snapshots, deltas, plans,
and applied results. Sanitized delta artifacts use `fixture-delta`; interruption
and replay checks use `fixture-safety-apply`, with `--updated` replaying a
changed source snapshot through the same apply run.
The plan and apply are resumable by stable SHA-256 idempotency keys.
The migration-owner-only field ledger stores source snapshots, payloads, field
coverage, and post-write target snapshots. Duplicate candidates are surfaced,
never merged. Rollback covers every mapped target with dependency-aware key
columns, before-images for updates, and deletion only for rows created by the
run. Append-only audit/history rows are retained with explicit rollback
evidence. Freeze-and-delta procedure and rollback commands are documented in
`docs/ibl/migration-runbook.md`.

Unsupported business rows, rejected rows, and unresolved duplicate candidates never satisfy completeness. Reconciliation requires the V2 migration-owner connection and verifies both the legacy ID map and target-row existence. Rollback checks target fingerprints and foreign-key dependencies before deleting only rows inserted by that run.
