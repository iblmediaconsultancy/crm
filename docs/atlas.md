# Atlas outreach

Atlas is the system operator for the IBL outreach workflow. It is represented by the `atlas-operator` CRM user and uses the existing Draft, OutboundDelivery, Postgres worker, Resend and MIAB ThreadWriter pipeline.

The default is fail-closed. Both `ATLAS_LIVE_OUTREACH_ENABLED=true` and `appSetting.atlasLiveOutreachEnabled=true` are required before Atlas can queue an external email. `RESEND_OUTBOUND` must also be `VERIFIED` and a verified CRM mailbox must exist as the outbound envelope.

## Configuration

Production expects:

- `RESEND_API_KEY_FILE`
- `RESEND_WEBHOOK_SECRET_FILE`
- `RESEND_OUTREACH_FROM_EMAIL=outreach@iblmedia.com`
- `RESEND_OUTREACH_FROM_NAME=IBL Media Team`
- `ATLAS_LIVE_OUTREACH_ENABLED=false`
- `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET_FILE` for token refresh
- `GOOGLE_CALENDAR_PRIMARY_ID` for Ihsan's IBL calendar, defaulting to `primary`
- `GOOGLE_CALENDAR_HVA_ID` and optional `GOOGLE_CALENDAR_BLOCKER_IDS`; every listed calendar is treated as unavailable time

The Resend sender address is applied by the worker. Inbound replies do not use Resend: MIAB IMAP sync passes normalized messages to `ThreadWriterService`, which writes the email thread, message and activity, cancels active follow-up plans, marks the delivery replied, and advances the linked lead to `REPLIED`.

## Safety gates

Atlas only queues email when all of the following are true:

- Monday through Friday, 09:00–18:00 Europe/Amsterdam
- the contact is active and `ALLOWED`
- the email route is attached to the lead and is not globally or route suppressed
- the lead is `NEW` or `READY`, has a next action, and is not handed off, parked or suppressed
- no active follow-up sequence exists for the contact
- the contact cooldown has elapsed
- the language is English, Dutch or Turkish
- pricing, cost, budget or fee language is absent
- the daily cold-email quota is available, capped at 90
- the queue operation is idempotent

Once the worker sends the message, the lead advances to `CONTACTED` and receives a dated next action. An inbound reply advances it to `REPLIED` and cancels queued follow-ups. Bounce and complaint handling continues through the existing Resend webhook and suppression path.

## Meetings and calendar safety

Meeting requests are persisted as `PENDING_APPROVAL`. Team or Admin approval changes them to `APPROVED`; only an explicit confirmation rechecks Google FreeBusy for the IBL calendar and every configured blocker calendar, then creates the Google event using the write scope. A busy IBL or HvA interval changes the request to `BLOCKED`. There is no automatic meeting confirmation.

The current branch contains the read, availability, write, and approval flow, but the Google account, OAuth scopes, client credentials, and HvA calendar ID still require Ihsan's external setup.

## Mailbox and daily report

The additive mailbox migration provisions `outreach@iblmedia.com` as an MIAB mailbox owned by Atlas and creates its `miab` sync row. It stays `UNVERIFIED` until the real MIAB mailbox credential and provider proof are supplied. Once verified, the existing worker reads its INBOX and sends inbound messages through `ThreadWriterService`; no separate inbound parser is needed.

The weekday report is a separate `AtlasDailyReport` snapshot, scheduled at 19:00 Europe/Amsterdam and persisted by the Atlas agent even while live outreach is disabled. The Outreach workbench displays the latest persisted snapshot separately from live dashboard counters.

The versioned playbook is stored in `apps/agent/agent/lib/atlas-playbook.ts` and loaded into Atlas outreach instructions at session start. It is repository-controlled, not supplied by an external prompt or inferred from a lead.

## Enablement procedure

Keep the environment switch false until provider proof and a controlled pilot have passed. The pilot must verify a real Resend send, inbound reply ingestion, follow-up cancellation, bounce and DNC behavior, duplicate prevention, working hours, quota, language, pricing, handoff, calendar approval and audit reporting. Increase volume gradually; the 90/day value is a hard ceiling, not a starting target.

To roll back, set `ATLAS_LIVE_OUTREACH_ENABLED=false`, set the CRM Atlas setting false, cancel active follow-up plans, and leave historical email, activity, delivery and audit rows intact.
