# ADR 0002: Dedicated Prisma and PostgreSQL database

- Status: Accepted for Phase 0
- Date: 2026-08-08

## Context

Comp already uses Prisma 7 and PostgreSQL. V2 needs transactional migrations, row-level mailbox controls, and durable row leasing.

## Decision

Use a dedicated V2 PostgreSQL database managed through Prisma migrations. Phase 0 uses an isolated database, port, role, and volume.

## Alternatives

Sharing V1 Supabase, SQLite, and a second ORM were rejected because they weaken isolation or add divergence.

## Consequences

RLS SQL remains a reviewed migration concern alongside Prisma models. Release automation must run migrations explicitly.

## Security invariants

V1 and V2 never share runtime credentials, schemas, roles, or connection pools. Application traffic uses a non-owner role.

## Reversal conditions

Reverse if Comp changes its supported persistence layer or PostgreSQL cannot meet a proven requirement.
