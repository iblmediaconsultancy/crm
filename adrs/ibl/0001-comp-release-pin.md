# ADR 0001: Pin the Comp release foundation

- Status: Accepted for Phase 0
- Date: 2026-08-08

## Context

Comp's `release` branch resolves to `c26a08d63db7d22e86bcdfe76872c86c7f640ea1`. Tag `v1.4.0` resolves to `db65dd6e2445826d7af9df2893f5f5227c0127bb`; both commits have tree `81b51d5d1191b5e6047a384fdcaa6ca4d7304865`.

## Decision

Use the release-promotion commit `c26a08d63db7d22e86bcdfe76872c86c7f640ea1` as the immutable V2 base and preserve the upstream MIT notice.

## Alternatives

Tag `v1.4.0`, a moving release branch, and latest main were rejected because the approved baseline names the promotion commit and reproducibility requires a full SHA.

## Consequences

Upstream updates require an explicit review and new ADR. Security fixes do not arrive automatically.

## Security invariants

Build inputs must resolve to the recorded commit and tree. No dependency or source is fetched from V1.

## Reversal conditions

Reverse only after reviewing a newer Comp release, its migration delta, licenses, and Phase 0 security gates.
