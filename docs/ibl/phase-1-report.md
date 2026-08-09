# IBL Command Center V2 Phase 1 report

- Date: 2026-08-08
- Scope: Phase 1 development foundation only
- Foundation: Comp `c26a08d63db7d22e86bcdfe76872c86c7f640ea1`
- Decision: **PASS for local Phase 1 development; provider-dependent capabilities remain BLOCKED**

## Outcome

Phase 1 establishes the isolated IBL application, authentication, identity, role, mailbox-security, API, agent, database, and local deployment foundations in `C:\Coding\ibl-command-center-v2`. The Comp release pin and dependency lock remain unchanged. V1 remains clean at `41e7e0ccf2a012eeb448b5007504e89e289b300c`.

The real Mail-in-a-Box and Resend proof is still unexecuted. Both provider capabilities are seeded `UNVERIFIED`; no Phase 1 API can promote them. This is a development-only pass, not production readiness or cutover approval.

## Implemented architecture

| Area | Result |
| --- | --- |
| Web | IBL-branded Next 16 app on Node 24.18.0; public marketing root redirects to sign-in |
| API | Existing Nest/tRPC API on Bun with protected profile, workspace, mailbox, and provider-status surfaces |
| Agent | Eve 0.29.4 process with default-deny manifest, deny-all network policy, and no outbound-email/shell/root-delegation tools |
| Database | PostgreSQL 17 / Prisma 7 with separate migration-owner and non-owner application identities |
| Authentication | Better Auth invite-only email/password, cookie prefix `ibl-v2`, no social/SSO provider initialization |
| Deployment | Private local Docker Compose skeleton only; no public deployment |
| V1/Supabase | No runtime dependency, read, migration, or mutation |

## Schema additions

The Phase 1 migration adds:

- `UserProfile` with active/suspended status, language, locale, time zone, working preferences, and audit timestamps.
- Exact organization roles `admin | team | contributor`, including conversion of isolated Comp role values.
- `Mailbox` and `MailboxGrant`, with MIAB identity metadata but no credentials.
- `ProviderCapability` keys `MIAB_IMAP` and `RESEND_OUTBOUND`, both seeded `UNVERIFIED`.
- Required mailbox scope and mailbox-local identities for syncs, threads, and messages.
- `SecurityAuditEvent` for administrative and security outcomes.
- Forced RLS on mailboxes, grants, threads, and messages.
- A deferred database constraint trigger protecting the final active Admin.

## Security invariants proven

- A sole active Admin cannot be demoted, suspended, removed, or deleted.
- Promotion and prior-Admin demotion can commit atomically.
- Concurrent demotions cannot both succeed.
- Concurrent demotion and suspension cannot reduce active Admin count to zero.
- Direct SQL bypass is rejected by the deferred constraint trigger.
- Failed service operations roll back their mutation and in-transaction audit.
- Mailbox owner and active delegate can read; unrelated users and unrelated Admins cannot.
- An unscoped application principal sees no mailbox rows.
- A worker sees only its explicitly scoped mailbox.
- Profile-only research accepts `mailboxId = null`.
- An owned `UNVERIFIED` mailbox contributes address, display name, signature, language, and preferences to identity context.
- Mailbox mismatch is rejected and durably audited.
- Provider guards reject before credential lookup, provider construction, queueing, or network work.
- The agent capability manifest contains no outbound email, SMTP, Resend, generic shell, unrestricted runner, or root delegation.

## Authentication result

The local-only bootstrap rejects production mode and remote database hosts. Against the isolated database, a synthetic bootstrapped Admin successfully signed in with Better Auth. Public email/password signup was rejected. Invitation and reset delivery remain behind the unverified Resend gate.

## Build and test evidence

| Gate | Result |
| --- | --- |
| Complete fresh 38-migration chain against isolated PostgreSQL 17 | Pass |
| Prisma schema validation and client generation | Pass |
| API tRPC generation | Pass: 19 routers, 122 procedures |
| API typecheck | Pass |
| Auth typecheck | Pass |
| DB typecheck | Pass |
| Agent typecheck | Pass |
| Node 24.18.0 / Next 16.3.0 / Turbopack clean build run 1 | Pass |
| Node 24.18.0 / Next 16.3.0 / Turbopack clean build run 2 | Pass |
| Phase 1 role/security/integration/agent suite | Pass: 15 tests, 42 assertions |
| Better Auth bootstrap/sign-in/signup suite | Pass: 2 tests, 2 assertions |
| Docker Compose configuration | Pass |
| Local browser sign-in shell at 390x844 and 1440x900 | Pass: no horizontal overflow, labeled controls, semantic focus order, no console errors |
| V1 status and commit verification | Pass |
| `git diff --check` | Pass |
| Real MIAB TLS/auth/read-only fetch | **Blocked / unexecuted** |
| Phase 0 architecture regression suite | Pass: 16 tests, 51 assertions |
| Exactly-one Resend-to-MIAB receipt proof | **Blocked / unexecuted** |

The standalone app `tsc` process was also attempted in a Bun container and a Node container. Both exceeded their diagnostic timeout without an emitted error on the Windows bind mount. The authoritative Next production build completed TypeScript successfully twice in approximately two minutes per run.

Browser validation covered the unauthenticated IBL sign-in shell. Authenticated navigation/settings behavior is covered by the production build and API/security tests, but a complete signed-in visual accessibility audit remains recommended before design sign-off.

## Build fixes found during acceptance

- Prisma model types used in public API declarations required explicit bounded return annotations.
- The profile response uses a finite DTO so recursive Prisma JSON types do not leak into the generated tRPC declaration.
- Authenticated mailbox and provider-status settings opt out of static prerendering because they require session/runtime data.
- Stale owner/member UI labels were replaced with Admin/Team/Contributor.
- The dormant SSO control fails closed and has no Better Auth SSO client call.

No dependency was upgraded and `bun.lock` is unchanged.

## Explicit provider-proof block

Until the real Phase 0 provider proofs pass, the following remain blocked:

- MIAB credential storage or connection
- IMAP sync and message ingestion
- real-user mailbox onboarding
- production mailbox or historical email migration
- invitation, verification, and password-reset delivery
- Resend initialization
- manual or automated outbound email
- agent outbound-email tools
- production mailbox cutover
- production deployment or cutover

The following remain allowed locally:

- profile-only research with no mailbox
- research/drafting with authorized unverified mailbox identity metadata
- local role, RLS, identity, drafting, and agent-security development

## Isolation confirmation

No production database, Supabase project, customer record, production mailbox, Resend account, or deployment endpoint was contacted. No email was sent. V1 was not modified. No commit, push, or deployment was performed.

## Remaining work and verdict

The only production-gating blocker intentionally carried forward is the real non-production MIAB preflight plus the explicitly approved exactly-one Resend-to-MIAB receipt proof.

**Verdict: PASS for Phase 1 local development foundation. NO-GO for provider-dependent operations, production mailbox work, production deployment, and cutover.**
