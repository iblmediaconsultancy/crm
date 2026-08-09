# IBL Command Center V2 Phase 2 report

## Result

Phase 2 is complete for the database domain and authorization foundation. The pinned Comp schema is extended through a 39th forward migration without changing V1 or weakening the Phase 0/1 invariants.

## Domain coverage

The Prisma model and migration now cover:

- football players, football agents, agencies, clubs, owned contact routes, explicit shared-route policies, representation state, and append-only representation history;
- configurable pipeline stages, leads, operational tasks, notes, evidence sources, proof items, templates, drafts, proposals, proposal items, and two-person outreach approval;
- assignments, append-only lifecycle events, duplicate candidates, explicit merge decisions, research requests/findings, and append-only domain audit events.

Legacy deal stages are seeded into deterministic pipeline-stage rows and existing deals are backfilled by key. The original `DealStage` field remains during the compatibility window.

## Integrity and authorization

The migration adds exact-subject checks, probability/confidence/value bounds, canonical duplicate ordering, decision-state checks, two-person approval, current-representation uniqueness, active-assignment uniqueness, and active shared-route uniqueness. Deferred database triggers reject invalid player/agent representation profiles and orphaned polymorphic references. Parent deletion is rejected when durable generic history still refers to the entity.

All 26 sensitive Phase 2 tables have both RLS and forced RLS. Shared CRM records require active workspace membership. Owned routes remain owner-writable; private routes are owner-readable until deliberately shared. Drafts, research requests, and mailbox evidence inherit mailbox ownership/read delegation. Admin or Team authority does not grant mailbox visibility. Append-only history/audit tables reject update and delete.

Outbound progression is database guarded. `APPROVED`, `QUEUED`, and `SENT` drafts require a distinct approved human decision, mailbox, route, and approval time. `QUEUED` and `SENT` additionally require verified `RESEND_OUTBOUND`; `SENT` requires `sentAt`. A decided approval cannot be rewritten.

## Reproducible evidence

Validation stack: `phase2/docker-compose.yml`, PostgreSQL 17, separate `BYPASSRLS` migration owner and `NOBYPASSRLS` runtime role, internal-only database network.

| Gate | Result |
| --- | --- |
| Prisma schema formatting and client generation | Pass |
| Offline migration image (engine cached at build time) | Pass |
| Fresh 39-migration chain | Pass |
| Destroy validation volume and fresh reapply | Pass |
| Pipeline seed/backfill | Pass |
| Representation profile and concurrency constraints | Pass |
| Polymorphic orphan rejection and parent-delete guard | Pass |
| Duplicate candidate surfaced without merge | Pass |
| Forced-RLS catalog for all 26 sensitive tables | Pass |
| Private/shared route cross-user behavior | Pass |
| Admin mailbox-bypass denial | Pass |
| Two-person approval and unverified-Resend denial | Pass |
| Non-member denial and append-only history | Pass |

The final focused suite result was 10 passed, 0 failed, 19 assertions. The complete chain was applied twice to newly initialized storage.

## Provider and data safety status

MIAB and Resend remain `UNVERIFIED`. Tests used synthetic `phase2.test` identities and local protocol state only. No credential was loaded, no external network operation was attempted by the validation database, and no message was sent. V1 was not read or modified during Phase 2 implementation.

