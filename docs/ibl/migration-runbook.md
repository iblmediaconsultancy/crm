# V1 to V2 migration runbook

## Safety model

Use a V1 database role with `CONNECT`, `USAGE` on the required schemas, and
`SELECT` only. Never use the V1 service-role key. Raw exports stay in the ignored
`phase6/artifacts/` directory with owner-only permissions. Reports contain only
counts, checksums, reason codes, watermarks, and hashed identifiers.

The V2 connection must be the migration owner, not an API or worker identity.
The control ledger is inaccessible to runtime roles. `apply` and `rollback`
require the explicit `--confirm-apply` switch.

## Full rehearsal

1. Freeze V1 writes or record a start watermark and announce the delta window.
2. Run `inventory`, then `export` under a repeatable-read read-only transaction.
3. Run `plan`; inspect `reconciliation.json`. A source row is always `MAPPED`,
   `REJECTED`, or `DUPLICATE_CANDIDATE`. Unsupported or unsafe records remain
   explicit rejections and are never silently discarded.
4. Resolve missing ownership and review duplicate candidates. Re-export if a
   plan input changes; checksums prevent mixed snapshots.
5. Run `reconcile`; require `zeroUnexplainedLoss: true` before any write.
6. Back up V2, set `DATABASE_URL` to the migration-owner connection, and run
   `apply --confirm-apply`. Stable source keys make interrupted reruns resumable.
7. Reconcile ledger counts and target foreign keys. Keep the generated run ID.
8. At cutover, freeze V1 writes, export a final snapshot/delta, repeat the dry
   run and apply, then switch traffic only after application smoke tests.

## Rollback

Set `V1_MIGRATION_RUN_ID` to the apply run ID and invoke `rollback
--confirm-apply`. The rollback manifest deletes only rows inserted by that run,
in reverse order, and marks each action. Restore the pre-apply V2 backup if any
post-cutover writer has created dependencies that make targeted rollback unsafe.

## Production limitations

The development export may be rehearsed locally. Production migration remains
blocked until production V1 read-only credentials, a freeze window, named data
owners, duplicate decisions, and a signed cutover approval are supplied.
