# ADR 0003: Better Auth with invite and reset migration

- Status: Accepted for Phase 0
- Date: 2026-08-08

## Context

Comp already uses Better Auth. Password hashes and active sessions are not assumed portable from V1.

## Decision

Keep Better Auth. Import user identity records through repeatable ETL, then use controlled invitations or password resets and revoke legacy sessions.

## Alternatives

Copying password/session material and retaining V1 authentication were rejected because compatibility and revocation cannot be guaranteed.

## Consequences

Users may complete a one-time activation flow. Phase 1 must design invitation expiry, reset delivery, audit, and support procedures.

## Security invariants

Authenticated IDs are server verified; roles never grant mailbox access; client identity claims never override the session.

## Reversal conditions

Reverse if a reviewed identity provider integration provides safer migration and equivalent Better Auth compatibility.
