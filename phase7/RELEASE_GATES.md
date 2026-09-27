# V2 production release gates

Deployment remains prohibited until every gate below has named evidence and release-owner approval. Passing unit tests does not satisfy these gates.

- Every app image and third-party service image is referenced by an immutable digest and passes clean-cache assembly.
- PostgreSQL 17 migrations succeed from empty and from the approved upgrade snapshot using the migration identity.
- API, worker, app, agent, migration, and backup identities are distinct and runtime identities are `NOBYPASSRLS`.
- Queue crash recovery, lease expiry, idempotent replay, poison-job handling, multiple replicas, and graceful shutdown pass with no Redis service or environment variables.
- DNS, HTTPS termination, trusted proxy behavior, cookie domain, and request limits are verified in the intended environment.
- MIAB read-only TLS evidence and controlled Resend evidence for both system and outreach senders are recorded through the operator-only probe.
- Private object storage and malware-scanner quarantine/download authorization are verified.
- An encrypted off-host backup is restored into an isolated database and application-level reconciliation passes.
- The production V1 inventory, owner classifications, freeze/delta export, apply, target reconciliation, rollback rehearsal, and reapply report zero unexplained business-data loss.
- Google and Microsoft runtime code remains quarantined. Redis remains absent unless a separately approved ADR supplies evidence and acceptance tests.
- A named release owner records final approval. Normal application UI cannot promote provider capabilities or approve deployment.

Run `phase7/ops/validate-production-config.sh` in the operator environment before rendering Compose. This validates configuration shape only; it never contacts providers or deploys services.