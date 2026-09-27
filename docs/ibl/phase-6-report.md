# IBL Command Center V2 Phase 6 report

## Result

The V1-to-V2 migration is implemented and rehearsed against the authorized V1
development Supabase database. V1 remained read-only and unchanged. Raw exports
are ignored and owner-readable; committed evidence contains no source values.

## Inventory and reconciliation

The source contains 75 public tables, 18 rows, 26 applied migrations, 144 RLS
policies, and 6 extensions. The repeatable-read export records per-file SHA-256
checksums plus a transaction watermark. All 18 source rows were accounted for:
10 mapped and 8 explicitly rejected as unsupported. There were no duplicate
candidates in the development snapshot and zero unexplained loss.

## Rehearsed behavior

- synthetic planner tests passed 4 tests and 6 assertions;
- migration tooling typecheck and formatting checks passed;
- the 42-migration chain applied the migration control ledger;
- apply validated the named V2 owner and target constraints before commit;
- a second apply was idempotent;
- the rollback manifest removed only the 10 rows inserted by the run;
- reapply after rollback restored the same 18 outcomes.

Production source access, freeze approval, data-owner decisions, and cutover
approval are external prerequisites. They are accurately left as operational
prerequisites rather than simulated provider or production evidence.
