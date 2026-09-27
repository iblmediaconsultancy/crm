# Deployment and operations runbook

## Prerequisites and secrets

Use Docker Engine with Compose, TLS termination in front of the loopback-bound
app/API ports, DNS for both public URLs, and six root-readable secret files.
Copy `phase7/.env.production.example` outside the repository and set absolute
secret-file paths. Generate independent random values; never reuse database,
session, cron, or agent-bridge secrets. Provider secrets are optional and must
remain absent while their capability is `UNVERIFIED`.

The migration service connects as `ibl_v2_migration` with `BYPASSRLS`. App,
API, worker, and agent connect only as `ibl_v2_app` with `NOBYPASSRLS`.
PostgreSQL and Redis have no edge-network attachment. The agent and worker have
outbound access but no published port. App/API/Prometheus bind to loopback by
default and must be exposed only through an authenticated, TLS-terminating
reverse proxy or private operator tunnel.

## Deploy

1. Pull the reviewed `codex/ibl-v2-completion` commit and verify its signature/hash.
2. Create a database backup and verify its SHA-256 sidecar.
3. Run `docker compose --env-file <external-env> -f phase7/docker-compose.yml config` and inspect image targets, mounts, networks, and secret paths.
4. Build with `docker compose ... build --pull` and run the one-shot `migrate` service.
5. Start `postgres redis api worker agent app prometheus`; require all healthchecks green.
6. Verify `/health/live`, `/health/ready`, signed-in operations, provider status, and one synthetic research request. Do not enable real providers without separate proof.
7. Observe alerts and structured logs for at least one worker interval before cutover.

## Backup and restore

Run the `backup` profile on schedule from the host. It creates a compressed
custom-format dump, an SHA-256 sidecar, owner-only permissions, and applies the
configured retention window. At least monthly, run `restore-verify.sh` in the
PostgreSQL image against the newest dump. A successful rehearsal creates an
isolated database, restores with `--exit-on-error`, verifies applied migration
rows, and removes the isolated database. Store encrypted off-host copies and
test recovery from that copy, not only the local volume.

## Monitoring and incident response

Prometheus uses the cron secret to scrape the otherwise forbidden metrics
endpoint. Route critical alerts to an on-call receiver outside this repository.
On API/database alerts, stop traffic, preserve logs, check Docker health and
PostgreSQL capacity, and avoid blind restarts during an active migration. Logs
are structured and must not include message bodies, addresses, tokens, or raw
provider responses. Run `audit-retention.sql` under the migration owner after
exporting legally required audit archives.

## Rollback and cutover

Before deployment, record the previous image digests and database migration
watermark. Application-only rollback switches to those immutable digests. If a
new migration is backward compatible, keep the database and roll back services.
For an incompatible migration, stop writers and restore the pre-deploy backup;
never attempt an ad-hoc down migration. V1-to-V2 data rollback follows the
separate migration runbook and its allowlisted rollback ledger.

Production cutover remains externally gated on named approval, real secret
injection, off-host backup verification, provider verification, DNS/TLS, and a
scheduled freeze window.
