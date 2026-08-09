# IBL Command Center V2 completion plan

- Branch: `codex/ibl-v2-completion`
- Foundation: `c26a08d63db7d22e86bcdfe76872c86c7f640ea1`
- Protected V1 baseline: `41e7e0ccf2a012eeb448b5007504e89e289b300c`
- Runtime: Bun 1.3.12 for package/API/agent tooling; Node 24.18.0 for Next 16.3.0 build and runtime; PostgreSQL 17; Prisma 7; Better Auth; Eve 0.29.4

## Non-negotiable gates

- V1 remains an immutable export source and its repository stays unchanged.
- Admin authority never implies mailbox access.
- Forced PostgreSQL RLS remains authoritative for mailbox data.
- The final active Admin is protected transactionally and under concurrency.
- Provider operations fail closed while capability state is `UNVERIFIED`.
- The Research Agent has no outbound-email, SMTP, Resend, shell, unrestricted runner, or root-delegation capability.
- Client identity overrides and mailbox mismatches are rejected and durably audited.
- Logs, fixtures, reports, and commits contain no real secrets or mailbox bodies.
- Every imported source row receives an explicit mapped, rejected, or duplicate-candidate outcome.
- Real MIAB and Resend status remains `UNVERIFIED` unless real-provider evidence is produced.

## Phase A: preserve and verify the foundation

- [x] Record the V1 commit and clean status.
- [x] Confirm the V2 foundation commit.
- [x] Create `codex/ibl-v2-completion` without discarding the Phase 0/1 worktree.
- [x] Read repository instructions, the V1 blueprint, ADRs, and Phase 0/1 reports.
- [x] Pass Phase 0 architecture proofs.
- [x] Pass Phase 1 authorization, RLS, concurrency, and Better Auth proofs.
- [x] Rehearse the existing 38-migration chain against isolated PostgreSQL 17.
- [x] Repair clean-cache Docker dependency installation.
- [x] Commit the preserved foundation and clean-build repair.

Exit gate: Phase 0/1 evidence is reproducible from the completion branch and preserved in a logical baseline commit.

## Phase B: finish Phase 1 product validation

- [x] Start the isolated signed-in application stack with synthetic users.
- [x] Exercise all signed-in navigation and settings surfaces.
- [x] Validate desktop and mobile widths, zoom, overflow, and touch targets.
- [x] Validate keyboard-only navigation, focus visibility/order, dialogs, sheets, and menus.
- [x] Run automated accessibility checks and manually review landmarks, headings, labels, names, descriptions, errors, and contrast.
- [x] Fix discovered defects without weakening authorization or provider gates.
- [x] Record browser, responsive, keyboard, and accessibility evidence.

Exit gate: signed-in critical paths pass browser, responsive, keyboard, and accessibility checks with no critical or serious defect.

## Phase C: complete the IBL domain model and authorization

- [x] Model players, football agents, agencies, clubs, companies, contacts, and contact routes.
- [x] Model representation relationships, shared-route policies, relationship history, and route ownership.
- [x] Model leads, deals, pipeline stages, tasks, notes, proof items, templates, drafts, proposals, and outreach approvals.
- [x] Model assignments, lifecycle history, evidence/source provenance, duplicate candidates, merge decisions, and durable audit.
- [x] Add explicit constraints, composite/partial indexes, foreign-key indexes, and idempotency keys.
- [x] Implement database authorization and forced RLS for sensitive and mailbox-scoped records.
- [x] Prove cross-user isolation, role behavior, ownership, lifecycle constraints, duplicate surfacing, and concurrency invariants.
- [x] Rehearse fresh schema creation and migration rollback/reapply on isolated PostgreSQL 17.

Exit gate: fresh migrations pass; schema/RLS tests cover every sensitive table; no orphan, silent merge, or role-based mailbox bypass is possible.

## Phase D: complete application workflows

- [x] Deliver overview, operational dashboards, and exact linked-filter counts.
- [x] Deliver player, agent, agency, club/company, and contact CRUD and search.
- [x] Deliver representation and shared contact-route management.
- [x] Deliver lead/deal pipeline, assignments, tasks, reminders, notes, and follow-ups.
- [x] Deliver research requests, evidence review, drafting, proposals, proof library, and templates.
- [x] Deliver human-controlled outreach approval and outbound status surfaces.
- [x] Deliver mailbox identity/delegation, provider status, team, and administration workflows.
- [x] Regenerate and verify the committed tRPC client types.
- [x] Add unit, service, API, and browser coverage for critical workflows and denials.

Exit gate: every requested workflow is usable end to end and unauthorized operations fail in UI, service, and database layers.

## Phase E: complete mailbox and communications

- [x] Add server-only MIAB credential interfaces with safe storage and redacted errors.
- [x] Implement certificate-verified IMAPS, folder discovery, read-only fetch, and incremental cursors.
- [x] Implement mailbox-scoped durable leases, retries, recovery, idempotency, normalization, threading, and deduplication.
- [x] Implement Resend transport with server-derived sender, idempotency, invitation/reset delivery, and human-approved outreach.
- [x] Keep synchronization and transport gated by provider capability state.
- [x] Add protocol doubles for TLS, IMAP, Resend, provider errors, retry behavior, and duplicate delivery.
- [x] Add health, metrics, structured logging, and durable audit without body or secret leakage.

Exit gate: protocol-double integration tests pass; unverified providers fail before credential/network work; no automated or agent send bypass exists.

## Phase F: complete the Research Agent

- [x] Extend authenticated identity envelopes for profile-only, mailbox-context, and CRM-target research.
- [x] Implement evidence/source tracking, research findings, drafts, proposals, and review tools in Eve.
- [x] Implement mailbox-scoped scheduled work and durable task settlement.
- [x] Keep capability discovery optional and default-deny.
- [x] Durably audit every denied capability attempt.
- [x] Statically and dynamically prove the agent cannot import or invoke outbound transport.
- [x] Add unit, integration, schedule, identity-tamper, data-boundary, and capability tests.

Exit gate: research and drafting work end to end with evidence; mailbox scope is enforced; outbound bypass proofs pass.

## Phase G: complete V1-to-V2 migration

- [x] Inventory the V1 development Supabase schema, extensions, policies, row counts, and applied migrations without logging sensitive values.
- [x] Create versioned read-only exports and manifests with checksums and watermarks.
- [x] Build dry-run-first ETL with explicit source-to-target mappings and stable idempotency keys.
- [x] Surface duplicate candidates; never silently merge.
- [x] Validate ownership and foreign keys before writes.
- [x] Support resumable batches, idempotent reruns, reconciliation, rollback manifests, and delta/freeze handling.
- [x] Test synthetic fixtures and the authorized development export.
- [x] Produce machine-readable and human-readable reconciliation reports with zero unexplained loss.

Exit gate: every source row is accounted for; reruns are stable; rollback is rehearsed; reports contain no sensitive content.

## Phase H: deployment and operations readiness

- [x] Provide production-shaped Docker services for app, API, worker, agent, migration, and PostgreSQL/development Supabase dependencies.
- [x] Separate migration-owner and least-privilege runtime identities.
- [x] Add health/readiness checks, graceful shutdown, rate limiting, security headers, trusted origins, and secure session settings.
- [x] Document and configure secret injection without committed secrets.
- [x] Add backup automation and complete a restore rehearsal.
- [x] Add monitoring, structured logs, alerts, audit retention, and operational dashboards/runbooks.
- [x] Produce dependency and license inventories.
- [x] Run concurrency, load, and key-query performance tests.
- [x] Rehearse development deployment, rollback, and migration cutover.

Exit gate: the development deployment is operational and observable; backup/restore and rollback rehearsals pass.

## Phase I: final acceptance and handoff

- [x] Run fresh database setup and the complete migration chain.
- [x] Pass builds, typechecks, lint, unit, integration, RLS, concurrency, migration, agent, API, and browser suites.
- [x] Pass responsive, keyboard, accessibility, security, dependency, license, and performance gates.
- [x] Verify V1 commit/status is unchanged.
- [x] Complete architecture, schema, authorization, environment, provider, migration, deployment, rollback, administration, and phase documentation.
- [x] Produce the final completion report with evidence, commits, changed files, limitations, risks, and the exact production-readiness verdict.
- [ ] Commit logical changes and push `codex/ibl-v2-completion` without pushing to `main`.

Exit gate: all independent development work is complete, every acceptance gate passes, external provider limitations are accurately marked, and the pushed branch is reviewable and deployment-ready.
