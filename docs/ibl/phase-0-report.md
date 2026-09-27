# IBL Command Center V2 Phase 0 report

- Date: 2026-08-08
- Updated after remediation: 2026-08-08
- Decision: **CONDITIONAL PASS FOR DEVELOPMENT ONLY; real-provider proof pending**
- Scope: isolated Phase 0 feasibility, security, and remediation only

## Executive result

The V2 foundation remains isolated at `C:\Coding\ibl-command-center-v2` on local branch `phase0/ibl-feasibility`, pinned to Comp commit `c26a08d63db7d22e86bcdfe76872c86c7f640ea1`. The dependency graph and `bun.lock` were not changed.

The Next.js build blocker is resolved without upgrading Comp: use Bun 1.3.12 only as the frozen-lockfile package manager and Node 24.18.0 as the Next build/runtime. Two clean bind-mounted Node/Turbopack builds and a fresh multi-stage Docker build passed. API, Eve, typechecks, deterministic upstream suites, and all existing Phase 0 architecture proofs pass.

The five internal `@crm/*` license uncertainties are resolved as private first-party workspace packages covered by Comp's repository-level MIT license. The corrected inventory has zero unresolved or legal-review entries.

By explicit owner exception, Phase 0 is a **CONDITIONAL PASS FOR DEVELOPMENT ONLY**. Real IMAP connectivity and the exactly-one approved Resend-to-MIAB receipt proof remain unexecuted and block every provider-dependent or production operation. No provider network request or real send occurred.

## Foundation integrity

| Item | Result | Evidence |
| --- | --- | --- |
| Comp release pin | Pass | HEAD remains `c26a08d63db7d22e86bcdfe76872c86c7f640ea1` |
| `v1.4.0` relationship | Pass | Tag commit `db65dd6e2445826d7af9df2893f5f5227c0127bb`; identical tree `81b51d5d1191b5e6047a384fdcaa6ca4d7304865` |
| Dependency preservation | Pass | No `package.json`, Next, React, Prisma, Eve, or `bun.lock` changes |
| V1 isolation | Pass | V1 remains at `41e7e0ccf2a012eeb448b5007504e89e289b300c`; no V1 file was modified |
| Production isolation | Pass | No Supabase production, production database, production mailbox, customer data, deployment, commit, or push |
| Phase boundary | Pass | No Phase 1 implementation or branding |

## Next.js build root cause and exact fix

### Root cause

The pinned application uses Next 16.3.0. Next 16 defaults `next build` to Turbopack and officially supports Node 20.9 or newer. Comp's root manifest requires Node `>=22` while pinning Bun 1.3.12 as its package manager.

Under the Linux `oven/bun:1.3.12` container, Next compiles and typechecks, then its page-data worker loads `next/dist/compiled/next-server/app-page-turbo.runtime.prod.js`. Bun throws its internal CommonJS invariant:

> Expected CommonJS module to have a function wrapper. If you weren't messing around with Bun's internals, this is a bug in Bun.

Bun then panics with a segmentation fault/SIGILL. The same pinned source and installed dependency tree completes under Linux Node 24.18.0 with default Turbopack. This establishes:

| Candidate | Finding |
| --- | --- |
| Bun-specific | **Yes.** The failing invariant and process panic originate in Bun; Node passes unchanged source and dependencies. |
| Turbopack-specific | **Trigger-specific, not independently proven as a Turbopack defect.** The failure occurs while Bun evaluates Next's generated Turbopack CommonJS runtime. |
| Windows-specific | **No.** The crash occurred inside a Linux x64 container. |
| Dependency/version-specific | **Compatibility combination.** It is reproducible with Bun 1.3.12 and Next 16.3.0; the pinned tree itself is valid under Node. |
| Comp application defect | **No.** Comp source builds unchanged with its declared supported Node engine. The upstream release recipe exposes the Bun/Next runtime incompatibility. |

Bun with Next's supported `--webpack` opt-out did not reproduce the immediate CommonJS crash but failed to complete within a five-minute diagnostic bound. It is not accepted as a workaround.

### Exact fix

- Keep `bun@1.3.12` for `bun install --frozen-lockfile` and compatible tests/tools.
- Pin Node `24.18.0` for Next build and runtime.
- Retain Next 16.3.0's default Turbopack build.
- Do not upgrade Next, React, Turbopack, Prisma, Eve, or other Comp dependencies.
- Use the Phase 0 multi-stage Docker shape: Bun dependency stage, Node build stage, Node runtime stage.

Pinned images used:

- `oven/bun:1.3.12@sha256:8956c7667fa17beb6e3c664115e66bdacfe502da5d99603626e74c197bdef160`
- `node:24.18.0-bookworm@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059`
- `node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d`

Local runtime proof image: `ibl-v2-phase0-node-build@sha256:af9ddd7c5c3590b067d6bde73ed155ea9cee3e89f88e9abc71589cd9a7e8be12`; `node --version` returned `v24.18.0`.

Official references: [Next 16 runtime and Turbopack defaults](https://nextjs.org/docs/app/guides/upgrading/version-16), [Next deployment requirements](https://nextjs.org/docs/app/guides/deploying-to-platforms), [Bun Next.js guidance](https://bun.sh/docs/guides/ecosystem/nextjs), [upstream Bun Next 16 crash report](https://github.com/oven-sh/bun/issues/23944).

## Upstream test-suite assessment

### Durable dispatcher failure

`queueDueAgentRuns()` queries all enabled due live schedule triggers and returns the number it successfully claims. The durable runtime test expects four concurrent calls to claim exactly its one trigger. In parallel, `apps/api/test/agent-lifecycle.spec.ts` creates another live schedule trigger with `nextRunAt` fixed at `2026-08-06T12:00:00.000Z`. Both package runners used the same database, so the agent test could legitimately claim both and report 2.

This is an upstream cross-package test-isolation defect. It is not a dispatcher duplication defect: the isolated file passed, the deterministic suite passed, and ten repeated file runs produced 110/110 passing tests.

### Auth e2e failure

`@crm/auth` computes its exported provider environment once at module import. The auth e2e file sets fallback Google variables during its own module initialization and dynamically imports the Nest application afterward. Bun loads test files concurrently, so another file can import `@crm/auth` before the fallbacks exist. The service then retains `google: false` while the e2e assertion expects the newly set variables to mean `google: true`. Resource contention can also exceed Bun's default five-second Nest setup timeout.

This is an upstream environment/import-order and timeout isolation defect. With deterministic variables set before process start and a 30-second e2e timeout, ten repeated file runs produced 50/50 passing tests.

### Remediation approach

No upstream product code or unrelated Comp test was rewritten. The Phase 0 runner:

- accepts only local hosts and an allowlisted database name beginning `ibl_command_center_v2_phase0_test_`;
- drops/recreates only that dedicated local test database;
- applies all 37 pinned Comp migrations;
- sets synthetic auth variables before any test imports;
- runs database-sharing workspace package suites sequentially;
- retains normal concurrency inside each package;
- uses a 30-second test timeout for cold Nest initialization.

Three complete deterministic validation runs passed in total: one harness validation plus the required two-run matrix. The final matrix also passed auth 50/50 and durable runtime 110/110 across the targeted repetitions. The original unisolated parallel command remains non-authoritative and may still flap; this is documented upstream debt, not a V2 blocker.

## License and notice resolution

The generated inventory contains 60 direct runtime dependencies and zero unresolved/legal-review entries. The five former uncertainties are:

| Package | Classification | Notice source | Legal review |
| --- | --- | --- | --- |
| `@crm/auth` | MIT, private first-party workspace | Root Comp `LICENSE` | No |
| `@crm/db` | MIT, private first-party workspace | Root Comp `LICENSE` | No |
| `@crm/env` | MIT, private first-party workspace | Root Comp `LICENSE` | No |
| `@crm/telemetry` | MIT, private first-party workspace | Root Comp `LICENSE` | No |
| `@crm/ui` | MIT, private first-party workspace | Root Comp `LICENSE` | No |

Exact obligations:

- Comp/internal packages: retain `Copyright (c) 2026 Comp AI` and the complete MIT permission/warranty notice in copies or substantial portions. No separate internal-package NOTICE exists.
- If an internal package is later published independently, add explicit MIT package metadata and distribute the root MIT text.
- Eve 0.29.4: distribute Apache-2.0 text, retain applicable notices, identify modified distributed Eve files, and preserve its Vercel NOTICE.
- `posthog-js` `(Apache-2.0 AND MIT)`: preserve its complete installed LICENSE containing PostHog's Apache terms and the identified Sentry, Meta, Expo, and AgentCat MIT notices/source headers.

No external legal confirmation is required for the five internal packages. Counsel is needed only if IBL changes the redistribution model, removes required notices, separately publishes packages without the license, or relies on upstream trademarks. See `phase0/licenses/NOTICE-OBLIGATIONS.md`.

## Provider proof preparation

The former combined smoke script was replaced by a no-send IMAP preflight and a separately guarded manual-send command.

The preflight enforces:

- `PHASE0_PROVIDER_SCOPE=DEDICATED_NON_PRODUCTION`;
- certificate-verified TLS with SNI;
- IMAPS port 993 only;
- mailbox-level authentication, never MIAB admin authentication;
- capability and folder discovery;
- read-only `EXAMINE INBOX`;
- `UID SEARCH` and optional `BODY.PEEK` only;
- no delete, move, flag, `STORE`, or printed body.

The send command additionally requires all of the following before any network connection:

1. A valid preflight UUID passed as `--preflight-run-id`.
2. The same UUID passed as `--approve-one-send`.
3. `PHASE0_SEND_APPROVAL=APPROVED_ONCE`, set only after explicit user approval.

It then validates `PHASE0_RESEND_TO` equals the dedicated IMAP user, derives From from server-side configuration, issues exactly one Resend `POST /emails`, uses `ibl-phase0/provider/<run-id>` as the 24-hour idempotency key, records only redacted provider evidence, and polls through read-only IMAP.

Both commands were run without credentials. The preflight stopped at the dedicated-scope gate; the send stopped at the approval gate before credential evaluation or network access. Zero provider requests and zero sends occurred.

### Exact configuration required from the user

Place these only in ignored root `.env.phase0.local`:

| Variable | Required value |
| --- | --- |
| `PHASE0_PROVIDER_SCOPE` | Literal `DEDICATED_NON_PRODUCTION` |
| `PHASE0_IMAP_HOST` | FQDN of the dedicated MIAB box, matching its publicly trusted TLS certificate |
| `PHASE0_IMAP_PORT` | Literal `993` |
| `PHASE0_IMAP_USER` | Full address of a dedicated non-production mailbox |
| `PHASE0_IMAP_PASSWORD` | Password for that mailbox only; never the MIAB administrator password |
| `PHASE0_RESEND_API_KEY` | New Resend `sending_access` key restricted to the verified non-production subdomain |
| `PHASE0_RESEND_FROM` | Server-owned identity such as `IBL Phase 0 <phase0@send.nonproduction.example>` |
| `PHASE0_RESEND_TO` | Exactly the same full address as `PHASE0_IMAP_USER` |
| `PHASE0_SEND_APPROVAL` | Keep `NO`; change to `APPROVED_ONCE` only for the separately approved run |

The Resend subdomain must show verified SPF/DKIM status and must not be a production/customer sending domain. Port 993 must be reachable from the local Docker environment. The key must not have full access and should be revoked after evidence is retained.

Official references: [MIAB port/setup requirements](https://mailinabox.email/guide.html), [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction), [Resend sending-only/domain-scoped keys](https://resend.com/docs/dashboard/api-keys/introduction), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Architecture proof status

| Proof | Result |
| --- | --- |
| Owner-only mailbox repository authorization | Pass |
| PostgreSQL RLS owner/delegate/worker matrix | Pass |
| Admin and unrelated user body denial | Pass |
| Authenticated AI identity/tamper rejection | Pass |
| Durable `FOR UPDATE SKIP LOCKED` leasing/recovery | Pass |
| Agent no-send/default-deny capability | Pass |
| Agent outbound static scan/audit denial | Pass |
| Exactly 100 synthetic source rows and mappings | Pass |
| Migration duplicates/FKs/ownership/idempotency/log safety | Pass |
| MIAB/Resend protocol doubles | Pass |
| Real MIAB TLS/auth/read-only fetch | **Unproven** |
| Exactly-one Resend send and MIAB receipt | **Unproven** |

The Phase 0 suite passed 16/16 tests, 51 assertions. Any cross-mailbox body exposure or agent send capability remains an automatic failure; neither was observed.

## Updated build and test results

| Check | Result |
| --- | --- |
| Node 24.18.0 + Next 16.3.0 + Turbopack clean build, run 1 | Pass |
| Node 24.18.0 + Next 16.3.0 + Turbopack clean build, run 2 | Pass |
| Bun 1.3.12 + Next/Turbopack diagnostic | Fail, upstream Bun CommonJS panic |
| Bun 1.3.12 + Next/webpack diagnostic | Inconclusive/unsupported, five-minute timeout |
| Multi-stage Bun-install/Node-build Docker runtime image | Pass, no Dockerfile warning on final run |
| Runtime image Node version | Pass, `v24.18.0` |
| API build | Pass |
| Eve self-host build | Pass, Linux x64 output |
| API typecheck | Pass |
| Agent typecheck | Pass |
| Deterministic upstream suite | Pass three complete runs total |
| Auth e2e targeted repetition | Pass, 50/50 |
| Durable runtime targeted repetition | Pass, 110/110 |
| Phase 0 architecture suite | Pass, 16/16 and 51 assertions |
| License inventory | Pass, 60 dependencies and 0 legal-review entries |
| Provider fail-closed dry runs | Pass, zero network requests/sends |
| Biome check of remediation TypeScript | Pass |
| `git diff --check` | Pass |

## Remediation file changes

Added:

- `.dockerignore`
- `phase0/Dockerfile.node-build`
- `phase0/licenses/NOTICE-OBLIGATIONS.md`
- `phase0/scripts/build-matrix.ps1`
- `phase0/scripts/run-upstream-tests.ts`
- `phase0/src/real-imap.ts`
- `phase0/scripts/provider-preflight.ts`
- `phase0/scripts/provider-manual-send.ts`

Updated:

- `phase0/README.md`
- `phase0/provider-env.example`
- `phase0/scripts/license-inventory.ts`
- `phase0/licenses/direct-runtime.json`
- `docs/ibl/phase-0-report.md`

Removed:

- `phase0/scripts/real-provider-smoke.ts`, replaced by the split fail-closed provider commands

No Comp application source, dependency manifest, lockfile, migration, V1 file, or production configuration changed.

## Remaining blockers and verdict

| Blocker | Owner | Required evidence |
| --- | --- | --- |
| Real MIAB path unproven | IBL infrastructure | Dedicated credentials; successful TLS/auth/capability/folder/read-only fetch preflight |
| Real Resend-to-MIAB path unproven | IBL infrastructure and explicit approver | Verified test subdomain, restricted sending key, explicit approval for one run, one idempotent send, read-only IMAP receipt |

**CONDITIONAL PASS FOR DEVELOPMENT ONLY. Provider-dependent operations and production remain NO-GO.**

The build, deterministic test, licensing, privacy, identity, leasing, migration, Docker, and agent-permission blockers are resolved. The only mandatory blockers are the deliberately unexecuted real-provider gates. If both real-provider proofs pass without mailbox mutation, secret/body exposure, duplicate send, or agent capability expansion, Phase 0 can be updated to **GO for Phase 1 consideration**.
