# ADR 0006: Agent permissions exclude outbound send

- Status: Accepted for Phase 0
- Date: 2026-08-08

## Context

Eve 0.29.4 authored tools run in the trusted app runtime, default sandbox egress is allow-all, and the root delegation tool is enabled unless disabled.

## Decision

Use an explicit default-deny capability manifest with read, research, and proposal tools only. Disable generic shell/file write, Workflow, root-copy delegation, generic runners, and all outbound mail transports; sandbox egress is deny-all.

## Alternatives

Prompt-only prohibition, approval-gated send, and unrestricted delegated agents were rejected because capabilities must fail closed below the model layer.

## Consequences

Human-operated application code owns manual send. Every denied attempt creates an audit event.

## Security invariants

No agent-importable Resend/SMTP/send endpoint exists. Declared subagents inherit nothing and must repeat the same restrictions. Secrets never enter a sandbox.

## Reversal conditions

Reverse only through a separate approved phase with scoped action types, human authorization, idempotency, audit, and abuse controls.
