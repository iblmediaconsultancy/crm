# V1 to V2 migration runbook

## Safety model

Use a V1 database role with `CONNECT`, `USAGE` on the required schemas, and
`SELECT` only. Never use the V1 service-role key. Raw exports stay in the ignored
`phase6/artifacts/` directory with owner-only permissions. Reports contain only
counts, checksums, reason codes, watermarks, and hashed identifiers.

Before connecting, run `phase6/v1-readonly-role.sql` in the V1 Supabase SQL
Editor. It creates the restricted role from the 82-table export policy. Then
run `phase6/v1-readonly-role-verification.sql` through that role and require
zero dangerous inherited privileges. The exporter reads table and column names
from PostgreSQL catalogs, not `information_schema.columns`, so secret columns
remain ungranted while schema drift is still detected.
Inherited PUBLIC `TEMPORARY` is reported but is not treated as a persistent-data
write path. Existing policies formerly targeted to PUBLIC are scoped to the
normal `anon` and `authenticated` roles, preserving normal application behavior
while excluding the exporter. Public function execution is likewise retained
for `anon`, `authenticated`, and `service_role`, but not inherited by the
exporter.

The V2 connection must be the migration owner, not an API or worker identity.
The control ledger is inaccessible to runtime roles. `apply` and `rollback`
require the explicit `--confirm-apply` switch.

## Full rehearsal

1. Freeze V1 writes or record a start watermark and announce the delta window.
   The export transaction records `txid_current()`, `pg_current_snapshot()`,
   and capture time as one immutable snapshot boundary.
2. Run `inventory`, then `export` under a repeatable-read read-only transaction.
   Export validates the complete 82-table matrix and explicit source columns
   before selecting data. Unknown tables or columns fail closed. Secret-bearing
   columns are omitted from the SQL projection; `mailbox_credentials` exports
   only safe mailbox metadata.
3. Run `plan`; inspect `reconciliation.json`. A source row is always `MAPPED`,
   `REJECTED`, or `DUPLICATE_CANDIDATE`. Unsupported or unsafe records remain
   explicit rejections and are never silently discarded.
4. Resolve missing ownership and review duplicate candidates. Re-export if a
   plan input changes; checksums prevent mixed snapshots.
5. Run `reconcile`; require `zeroUnexplainedLoss: true` before any write.
6. Back up V2, set `DATABASE_URL` to the migration-owner connection, and run
   `apply --confirm-apply`. Stable source keys make interrupted reruns resumable.
7. Reconcile ledger counts and target foreign keys. Keep the generated run ID.
8. For each post-snapshot window, export a deterministic delta containing
   ordered upserts and deletes, tied to the prior manifest checksum and both
   watermarks. Run `delta` and `delta-replay` to validate the window and its
   replay fingerprint. Replay deltas in dependency order and reconcile after every
   replay. At cutover, freeze V1 writes, export a final delta, repeat the dry
   run and apply, then switch traffic only after application smoke tests.

## Rollback

Set `V1_MIGRATION_RUN_ID` to the apply run ID and invoke `rollback
--confirm-apply`. The rollback ledger covers the complete mapped target set,
restores updated rows from before-images, and deletes only rows inserted by
that run in reverse dependency order. If a post-cutover writer changed a
fingerprinted row, rollback stops and requires review. Append-only audit and
history rows are retained and marked as preserved rather than mutated. Run
`rollback-reconcile` afterward to verify the ledger, preserved durable rows,
and foreign-key integrity.

## Production limitations

The development export may be rehearsed locally. Production migration remains
blocked until production V1 read-only credentials, a freeze window, named data
owners, duplicate decisions, and a signed cutover approval are supplied.
