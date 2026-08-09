# ADR 0004: Owner-only mailbox isolation

- Status: Accepted for Phase 0
- Date: 2026-08-08

## Context

Email bodies are private user data. CRM administration and mailbox delegation are different authorities.

## Decision

Enforce owner or explicit read-grant access in both repositories and PostgreSQL RLS. Admin is not a mailbox permission. Workers receive one leased mailbox scope.

## Alternatives

Workspace-wide visibility, Admin bypass, and application-only filtering were rejected as excessive privilege or single-layer controls.

## Consequences

Cross-mailbox reporting requires purpose-built, privacy-reviewed projections. Support cannot inspect bodies by default.

## Security invariants

Unscoped roles see zero rows. Any cross-user body exposure is a release blocker. Worker context cannot enumerate other mailboxes.

## Reversal conditions

Only an explicit product/legal decision with a new threat model, auditable consent, and equivalent database enforcement can reverse this ADR.
