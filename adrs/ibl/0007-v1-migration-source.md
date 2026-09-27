# ADR 0007: V1 is an immutable export source

- Status: Accepted for Phase 0
- Date: 2026-08-08

## Context

Sharing live data access between V1 and V2 would couple rollback, authorization, and schema evolution.

## Decision

Treat V1 as an immutable export source. Run repeatable, versioned ETL into V2 with complete source-to-target mappings, reconciliation, explicit rejects, and duplicate candidates.

## Alternatives

Shared runtime reads, dual writes, direct Supabase migration, and one-off scripts were rejected because they are hard to audit and roll back.

## Consequences

Cutover needs export timing, freeze/delta handling, acceptance reconciliation, and a rollback window. Phase 0 uses synthetic data only.

## Security invariants

ETL logs never contain credentials or message bodies. Every source row has an outcome. No production endpoint is contacted during Phase 0.

## Reversal conditions

Reverse only if a safer migration mechanism proves equivalent isolation, replay, reconciliation, and rollback.
