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

## Enablement procedure

Keep the environment switch false until provider proof and a controlled pilot have passed. The pilot must verify a real Resend send, inbound reply ingestion, follow-up cancellation, bounce and DNC behavior, duplicate prevention, working hours, quota, language, pricing, handoff, calendar approval and audit reporting. Increase volume gradually; the 90/day value is a hard ceiling, not a starting target.

To roll back, set `ATLAS_LIVE_OUTREACH_ENABLED=false`, set the CRM Atlas setting false, cancel active follow-up plans, and leave historical email, activity, delivery and audit rows intact.
