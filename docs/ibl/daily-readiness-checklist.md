# V2 Daily and Production Readiness Checklist

Status recorded 2026-08-26 after the completed V1 migration rehearsal at commit `02bd473`.

## Verified locally

- Normal browser workflows loaded for overview, operations, companies, contacts, deals, football directories, leads, tasks, outreach, duplicates, allocation, archived records, chat, settings, team, mailbox, and provider status.
- Local archive and restore completed for a seeded company with a required reason. The destructive permanent-delete action remained separately gated.
- Outreach showed CRM AI ready after the local API and Eve bridge were started with disposable local credentials. Live MIAB and Resend remained fail-closed.
- Local provider status remained `UNVERIFIED`; no mailbox identity was added and no provider call was made.
- Focused boundary, provider-double, MIME/mailbox, agent-auth, model, bridge, and system-email tests passed: 87 passed, 0 failed.
- Clean production-target Docker builds passed for migration, API, worker, agent, and app. The application TypeScript phase completed in 93 seconds inside the Next production build. Production-config validation and Compose validation passed with immutable image digests, HTTPS URLs, PostgreSQL coordination, no Redis dependency, and the required provider settings.
- A fresh local PostgreSQL backup restored into a fresh database with checksum verification, 64 migrations, 4 users, 15 companies, 45 contacts, 159 activities, zero unvalidated foreign keys, and exit-on-error restore. Zero football-player and email-thread rows reflected the local seed.

## Required before controlled real-email proof

- Obtain explicit release-owner authorization naming the test mailbox, recipient, sender identity, time window, and rollback owner.
- Verify MIAB IMAP over TLS, read-only mailbox credentials, per-user mailbox grants, sync/retry/idempotency behavior, MIME and attachment handling, and private attachment storage.
- Verify a restricted Resend key, verified sending domain and sender, webhook signing secret, webhook event idempotency, delivery-event reconciliation, and DNC rechecks at queue, claim, and send time.
- Create one independently approved draft and send only to the authorized test recipient. Confirm the provider event, CRM delivery state, mailbox thread, audit trail, and no follow-up restart after DNC.

## Required before production deployment or cutover

- Publish the verified local runtime images to the release registry by digest. The local build blocker was fixed by excluding host incremental TypeScript state and restoring the filtered migration dependency install; local immutable image IDs are recorded in `docs/ibl/docker-build-verification.md`.
- Provide encrypted off-host backup storage and complete a restore verification using the production backup procedure. Local restore and checksum verification passed; off-host encryption was not available on this machine.
- Complete DNS, TLS, secret-file provisioning, provider evidence, monitoring, alert routing, release-owner approval, and post-deploy smoke checks from the deployment runbook.
- Keep V2 runtime configuration independent of V1 and remove the V1 export credential from any runtime deployment environment.

## Release decision

V2 is suitable for daily local/internal use with local provider actions disabled. It is not authorized for controlled real-email proof or production deployment/cutover until the external provider, release, backup, and immutable-image gates above are evidenced and approved.
