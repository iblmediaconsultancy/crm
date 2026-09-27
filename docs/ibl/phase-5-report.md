# IBL Command Center V2 Phase 5 report

## Result

Eve now executes durable IBL research requests inside an authenticated owner, optional mailbox, and exact CRM-target envelope. It can record evidence and proposed findings, create unsent drafts and draft proposals, and submit work for human review. It cannot approve, queue, or send outreach.

## Runtime boundary

- every IBL tool call re-derives the active user profile, workspace role, owned mailbox context, research-request ownership, and target identity;
- mailbox and target tampering fail before domain access and produce durable security audit events;
- capabilities are an explicit allowlist over `read`, `research`, and `proposal` classes; everything else is denied and audited;
- capability discovery is optional and discloses no provider credentials or configuration;
- the sandbox remains deny-all for network egress, generic shell and root delegation remain disabled, and static scans reject provider/outbound transport imports;
- evidence content is hashed for provenance and is not copied into `EvidenceSource` rows.

## Durable scheduling

The 41st migration adds attempts, lease ownership/expiry, retry timing, and continuation state to `ResearchRequest`. A worker-only RLS policy permits bounded queue claim/settlement without granting domain access. Actual tool work switches back to the owning user/mailbox principal. Claims use `FOR UPDATE SKIP LOCKED`, exponential bounded retry, expired-lease recovery, and a four-attempt ceiling. A run without an evidence-backed finding cannot settle as review-ready.

## Reproducible evidence

| Gate | Result |
| --- | --- |
| Fresh forward migration to 41 migrations | Pass |
| Agent typecheck | Pass |
| Focused identity/data-boundary/runtime suite | 9/9 pass, 136 assertions |
| Complete pre-existing Eve regression suite | 235/235 pass, 623 assertions |
| Eve self-hosted Linux x64 production build | Pass, 22.3 MB output |
| Static outbound import proof | Pass |
| Dynamic `email.send` denial with durable audit | Pass |
| Profile-only, mailbox, and CRM-target envelopes | Pass |
| Lease/retry/recovery/idempotency/review settlement | Pass |

All identities, evidence, email addresses, and provider responses used by the suite were synthetic. No model or external provider call was required for the gate.
