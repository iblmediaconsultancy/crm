# ADR 0005: Mail-in-a-Box IMAP and Resend

- Status: Accepted for Phase 0
- Date: 2026-08-08

## Context

The MVP needs inbound mailbox sync and restricted manual outbound delivery without Gmail or Microsoft scope.

## Decision

Use Mail-in-a-Box IMAP over TLS for read-only sync and Resend for explicitly invoked sends. Derive From server-side and require provider idempotency keys.

## Alternatives

Gmail, Microsoft Graph, SMTP submission, and agent-controlled sending are outside MVP scope.

## Consequences

IMAP polling needs a durable worker. Provider-domain verification, bounce handling, and operational monitoring remain later-phase work.

## Security invariants

Connectivity checks use `EXAMINE` and `BODY.PEEK`; they never delete, move, flag, or mark mail. Dedicated test credentials never enter source or logs.

## Reversal conditions

Reverse if MIAB or Resend fails production security, deliverability, contractual, or reliability review.
