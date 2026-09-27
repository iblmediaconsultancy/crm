# IBL operational dashboard

Display these Prometheus panels over a 24-hour window:

- service availability: `up{job="ibl-api"}`;
- database readiness: `ibl_database_up`;
- API process memory: `ibl_process_resident_memory_bytes`;
- API process restarts: `resets(ibl_process_uptime_seconds[1h])`.

Operational data-quality panels use redacted SQL counts only: pending outreach
approvals, failed outbound deliveries by error code, overdue mailbox-sync retry
counts, leased research requests past expiry, and denied security/domain audit
events. Never display message bodies, addresses, credentials, or raw provider
responses.
