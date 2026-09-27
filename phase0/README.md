# IBL Command Center V2 Phase 0

This directory contains isolated feasibility and security prototypes only. It is not the V2 production implementation.

All database and provider commands must use the dedicated Phase 0 environment. Never copy V1 environment files or point these scripts at production.

## Local commands

```sh
docker compose -f phase0/docker-compose.yml config
docker compose -f phase0/docker-compose.yml up -d postgres
docker run --rm -e PHASE0_DATABASE_URL="postgresql://ibl_phase0_owner:ibl_phase0_local_only@host.docker.internal:55432/ibl_command_center_v2_phase0" -v "$PWD:/workspace" -w /workspace oven/bun:1.3.12 bun test phase0/tests
```

## Remediation checks

The pinned Next 16.3.0 application is installed with Bun 1.3.12 but built and run with Node 24.18.0. The default build proof performs two clean Node/Turbopack builds:

```powershell
& phase0/scripts/build-matrix.ps1
docker build -f phase0/Dockerfile.node-build --target runtime -t ibl-v2-phase0-node-build:local .
```

The Bun/Turbopack and Bun/webpack modes exist only to reproduce the recorded upstream runtime problem. They are not supported V2 build paths.

The deterministic upstream runner creates and replaces only an allowlisted local database, supplies synthetic auth configuration before imports, and runs database-sharing packages sequentially:

```sh
docker run --rm \
  -e PHASE0_TEST_DATABASE_URL="postgresql://ibl_phase0_owner:ibl_phase0_local_only@host.docker.internal:55432/ibl_command_center_v2_phase0_test_deterministic" \
  -v "$PWD:/workspace" -w /workspace oven/bun:1.3.12 \
  bun phase0/scripts/run-upstream-tests.ts --runs=2 --targeted
```

## Dedicated provider proof

Copy the variable names from `phase0/provider-env.example` into the ignored root `.env.phase0.local`. Supply only a dedicated Mail-in-a-Box mailbox, a DNS-verified non-production Resend subdomain, and a `sending_access` Resend key restricted to that subdomain.

The IMAP preflight never sends and uses TLS verification, `EXAMINE`, and `BODY.PEEK`:

```sh
bun --env-file=.env.phase0.local phase0/scripts/provider-preflight.ts
```

The output includes a unique `runId`. A send is still blocked unless the user explicitly approves that run, `PHASE0_SEND_APPROVAL=APPROVED_ONCE`, and both CLI run IDs match:

```sh
bun --env-file=.env.phase0.local phase0/scripts/provider-manual-send.ts \
  --preflight-run-id=<approved-run-id> \
  --approve-one-send=<approved-run-id>
```

The send command uses one Resend request with a deterministic 24-hour idempotency key, then confirms the message through read-only IMAP. It is never called by automated tests or the agent.
