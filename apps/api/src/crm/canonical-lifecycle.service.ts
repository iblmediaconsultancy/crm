import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { WorkspaceRole } from "@crm/auth";
import { type Db, type DomainEntityType, Prisma } from "@crm/db";
import {
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

export type CanonicalKind = "company" | "contact" | "deal";
type Actor = { userId: string; role: WorkspaceRole };
type Impact = {
	id: string;
	name: string;
	version: number;
	lifecycleState: "ACTIVE" | "ARCHIVED";
	dependencies: Record<string, number>;
};

@Injectable()
export class CanonicalLifecycleService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async assertCanUpdate(
		kind: CanonicalKind,
		id: string,
		actor: Actor,
	): Promise<void> {
		if (actor.role === "admin" || actor.role === "team") return;
		const record = await this.ownerOf(kind, id);
		if (record.lifecycleState !== "ACTIVE" || record.ownerId !== actor.userId) {
			const assigned = await this.db.assignment.findFirst({
				where: {
					entityType: kind.toUpperCase() as DomainEntityType,
					entityId: id,
					assigneeUserId: actor.userId,
					revokedAt: null,
				},
				select: { id: true },
			});
			if (!assigned) {
				throw new ForbiddenException(
					"Contributors may update only active records they own or are assigned.",
				);
			}
		}
	}

	ownerForCreate<T extends { ownerId?: string | null }>(
		input: T,
		actor: Actor,
	): T {
		return actor.role === "contributor"
			? { ...input, ownerId: actor.userId }
			: input;
	}

	async archive(
		kind: CanonicalKind,
		input: { id: string; version: number; reason: string },
		actor: Actor,
	) {
		if (actor.role === "contributor") {
			throw new ForbiddenException(
				"Contributors cannot archive canonical records.",
			);
		}
		return this.changeState(kind, input, actor.userId, "ARCHIVED");
	}

	async restore(
		kind: CanonicalKind,
		input: { id: string; version: number; reason: string },
		actor: Actor,
	) {
		if (actor.role === "contributor") {
			throw new ForbiddenException(
				"Contributors cannot restore canonical records.",
			);
		}
		return this.changeState(kind, input, actor.userId, "ACTIVE");
	}

	async bulkArchive(
		kind: CanonicalKind,
		input: { ids: string[]; reason: string },
		actor: Actor,
	) {
		if (actor.role === "contributor") {
			throw new ForbiddenException(
				"Contributors cannot archive canonical records.",
			);
		}
		const ids = [...new Set(input.ids)];
		const entityType = kind.toUpperCase() as DomainEntityType;
		return this.db.$transaction(async (tx) => {
			const rows =
				kind === "company"
					? await tx.company.findMany({
							where: { id: { in: ids }, lifecycleState: "ACTIVE" },
							select: { id: true },
						})
					: kind === "contact"
						? await tx.contact.findMany({
								where: { id: { in: ids }, lifecycleState: "ACTIVE" },
								select: { id: true },
							})
						: await tx.deal.findMany({
								where: { id: { in: ids }, lifecycleState: "ACTIVE" },
								select: { id: true },
							});
			const activeIds = rows.map((row) => row.id);
			const data = {
				lifecycleState: "ARCHIVED" as const,
				archivedAt: new Date(),
				archivedByUserId: actor.userId,
				archiveReason: input.reason.trim(),
				version: { increment: 1 },
			};
			if (kind === "company") {
				await tx.company.updateMany({
					where: { id: { in: activeIds }, lifecycleState: "ACTIVE" },
					data,
				});
			} else if (kind === "contact") {
				await tx.contact.updateMany({
					where: { id: { in: activeIds }, lifecycleState: "ACTIVE" },
					data,
				});
			} else {
				await tx.deal.updateMany({
					where: { id: { in: activeIds }, lifecycleState: "ACTIVE" },
					data,
				});
			}
			await tx.assignment.updateMany({
				where: { entityType, entityId: { in: activeIds }, revokedAt: null },
				data: { revokedAt: new Date() },
			});
			if (kind === "contact" && activeIds.length) {
				await this.cancelOutreachForContacts(tx, activeIds, "Contact archived");
			}
			if (activeIds.length) {
				await tx.lifecycleEvent.createMany({
					data: activeIds.map((entityId) => ({
						entityType,
						entityId,
						fromState: "ACTIVE",
						toState: "ARCHIVED",
						actorUserId: actor.userId,
						reason: input.reason.trim(),
					})),
				});
			}
			return {
				requested: ids.length,
				succeeded: activeIds.length,
				failed: ids.length - activeIds.length,
				message:
					activeIds.length === ids.length
						? null
						: "Some records were already archived, missing, or inaccessible.",
			};
		});
	}

	async deletionImpact(kind: CanonicalKind, id: string, actor: Actor) {
		this.assertAdmin(actor);
		const impact = await this.impact(kind, id, this.db);
		const confirmationId = randomUUID();
		const expiresAt = new Date(Date.now() + 10 * 60_000);
		const dependencyDigest = await this.dependencyDigest(
			kind,
			id,
			this.db,
			impact.dependencies,
		);
		await this.db.destructiveConfirmation.create({
			data: {
				id: confirmationId,
				entityType: kind.toUpperCase() as DomainEntityType,
				entityId: id,
				entityVersion: impact.version,
				dependencyDigest,
				requestedByUserId: actor.userId,
				expiresAt,
			},
		});
		const payload = {
			kind,
			id,
			confirmationId,
			version: impact.version,
			dependencyDigest,
			expiresAt: expiresAt.getTime(),
		};
		return {
			...impact,
			confirmationToken: this.sign(payload),
			expiresAt,
		};
	}

	async destructiveDelete(
		kind: CanonicalKind,
		input: {
			id: string;
			confirmationToken: string;
			canonicalName: string;
			reason: string;
		},
		actor: Actor,
	) {
		this.assertAdmin(actor);
		const payload = this.verify(input.confirmationToken);
		if (payload.kind !== kind || payload.id !== input.id) {
			throw new ConflictException(
				"The confirmation is not bound to this record.",
			);
		}
		// Persist the attempt outside the destructive transaction so a blocked or
		// failed deletion cannot erase its own audit trail. This metadata is
		// intentionally identifier-only and contains no canonical personal fields.
		await this.db.securityAuditEvent.create({
			data: {
				actorUserId: actor.userId,
				action: "CANONICAL_DESTRUCTION_ATTEMPTED",
				resourceType: kind.toUpperCase(),
				resourceId: input.id,
				outcome: "ATTEMPTED",
				metadata: {
					reason: input.reason.trim(),
					confirmationId: payload.confirmationId,
					version: payload.version,
				},
			},
		});
		return this.db.$transaction(
			async (tx) => {
				const impact = await this.impact(kind, input.id, tx);
				const confirmation = await tx.destructiveConfirmation.findUnique({
					where: { id: payload.confirmationId },
				});
				if (
					!confirmation ||
					confirmation.requestedByUserId !== actor.userId ||
					confirmation.entityType !==
						(kind.toUpperCase() as DomainEntityType) ||
					confirmation.entityId !== input.id ||
					confirmation.entityVersion !== payload.version ||
					confirmation.dependencyDigest !== payload.dependencyDigest ||
					confirmation.consumedAt ||
					confirmation.expiresAt.getTime() < Date.now()
				) {
					throw new ConflictException(
						"The destructive confirmation is invalid, expired, or already used.",
					);
				}
				if (
					impact.version !== payload.version ||
					(await this.dependencyDigest(
						kind,
						input.id,
						tx,
						impact.dependencies,
					)) !== payload.dependencyDigest
				) {
					throw new ConflictException(
						"The record or its dependencies changed. Generate a new impact preview.",
					);
				}
				if (impact.name !== input.canonicalName.trim()) {
					throw new ConflictException(
						"The canonical name confirmation does not match.",
					);
				}
				const metadata = {
					reason: input.reason.trim(),
					version: impact.version,
					dependencies: impact.dependencies,
				};
				const consumed = await tx.destructiveConfirmation.updateMany({
					where: {
						id: confirmation.id,
						consumedAt: null,
						expiresAt: { gte: new Date() },
					},
					data: { consumedAt: new Date() },
				});
				if (consumed.count !== 1) {
					throw new ConflictException(
						"The destructive confirmation was already consumed.",
					);
				}

				if (kind === "company")
					await tx.company.delete({ where: { id: input.id } });
				else if (kind === "contact")
					await tx.contact.delete({ where: { id: input.id } });
				else await tx.deal.delete({ where: { id: input.id } });
				await tx.securityAuditEvent.create({
					data: {
						actorUserId: actor.userId,
						action: "CANONICAL_RECORD_DESTROYED",
						resourceType: kind.toUpperCase(),
						resourceId: input.id,
						outcome: "SUCCESS",
						metadata,
					},
				});
				return { id: input.id, destroyed: true };
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
		);
	}

	private assertAdmin(actor: Actor) {
		if (actor.role !== "admin") {
			throw new ForbiddenException(
				"Only an Admin can destroy canonical records.",
			);
		}
	}

	private async ownerOf(kind: CanonicalKind, id: string) {
		const select = { ownerId: true, lifecycleState: true } as const;
		const record =
			kind === "company"
				? await this.db.company.findUnique({ where: { id }, select })
				: kind === "contact"
					? await this.db.contact.findUnique({ where: { id }, select })
					: await this.db.deal.findUnique({ where: { id }, select });
		if (!record) throw new NotFoundException("Canonical record was not found.");
		return record;
	}

	private async changeState(
		kind: CanonicalKind,
		input: { id: string; version: number; reason: string },
		actorUserId: string,
		toState: "ACTIVE" | "ARCHIVED",
	) {
		const reason = input.reason.trim();
		if (!reason) throw new ConflictException("A lifecycle reason is required.");
		const entityType = kind.toUpperCase() as DomainEntityType;
		const fromState: "ACTIVE" | "ARCHIVED" =
			toState === "ACTIVE" ? "ARCHIVED" : "ACTIVE";
		return this.db.$transaction(async (tx) => {
			const data = {
				lifecycleState: toState,
				archivedAt: toState === "ARCHIVED" ? new Date() : null,
				archivedByUserId: toState === "ARCHIVED" ? actorUserId : null,
				archiveReason: toState === "ARCHIVED" ? reason : null,
				version: { increment: 1 },
			} as const;
			const where = {
				id: input.id,
				version: input.version,
				lifecycleState: fromState,
			};
			const result =
				kind === "company"
					? await tx.company.updateMany({ where, data })
					: kind === "contact"
						? await tx.contact.updateMany({ where, data })
						: await tx.deal.updateMany({ where, data });
			if (result.count !== 1) {
				throw new ConflictException(
					"The record changed since it was opened. Refresh and try again.",
				);
			}
			if (toState === "ARCHIVED") {
				await tx.assignment.updateMany({
					where: { entityType, entityId: input.id, revokedAt: null },
					data: { revokedAt: new Date() },
				});
				if (kind === "contact") {
					await this.cancelOutreachForContacts(
						tx,
						[input.id],
						"Contact archived",
					);
				}
			}
			await tx.lifecycleEvent.create({
				data: {
					entityType,
					entityId: input.id,
					fromState,
					toState,
					actorUserId,
					reason,
				},
			});
			return {
				id: input.id,
				lifecycleState: toState,
				version: input.version + 1,
			};
		});
	}

	private async cancelOutreachForContacts(
		tx: Prisma.TransactionClient,
		contactIds: string[],
		reason: string,
	) {
		const plans = await tx.followUpPlan.findMany({
			where: {
				contactId: { in: contactIds },
				status: { in: ["ACTIVE", "PAUSED"] },
			},
			select: { id: true },
		});
		const planIds = plans.map((plan) => plan.id);
		if (planIds.length) {
			await tx.followUpPlan.updateMany({
				where: { id: { in: planIds } },
				data: { status: "CANCELLED", cancellationReason: reason },
			});
			await tx.followUpStep.updateMany({
				where: {
					planId: { in: planIds },
					status: { in: ["PENDING", "LEASED", "QUEUED"] },
				},
				data: { status: "CANCELLED", leaseOwner: null, leasedUntil: null },
			});
		}
		const drafts = await tx.draft.findMany({
			where: {
				recipientRoute: { contactId: { in: contactIds } },
				status: { in: ["DRAFT", "IN_REVIEW", "APPROVED", "QUEUED"] },
			},
			select: { id: true },
		});
		const draftIds = drafts.map((draft) => draft.id);
		if (draftIds.length) {
			await tx.draft.updateMany({
				where: { id: { in: draftIds } },
				data: { status: "CANCELLED" },
			});
			await tx.outboundDelivery.updateMany({
				where: {
					draftId: { in: draftIds },
					status: { in: ["PENDING", "RETRY", "SENDING"] },
				},
				data: {
					status: "CANCELLED",
					leaseOwner: null,
					leasedUntil: null,
					lastErrorCode: "CANONICAL_RECORD_ARCHIVED",
				},
			});
		}
	}

	private async impact(
		kind: CanonicalKind,
		id: string,
		client: Db | Prisma.TransactionClient,
	): Promise<Impact> {
		if (kind === "company") {
			const row = await client.company.findUnique({
				where: { id },
				select: {
					id: true,
					name: true,
					version: true,
					lifecycleState: true,
					_count: {
						select: {
							contacts: true,
							deals: true,
							activities: true,
							emailThreads: true,
							calendarEvents: true,
							contactRoutes: true,
							representations: true,
							leads: true,
							operationalTasks: true,
							notes: true,
							proofItems: true,
						},
					},
				},
			});
			if (!row) throw new NotFoundException("Canonical record was not found.");
			return {
				id: row.id,
				name: row.name,
				version: row.version,
				lifecycleState: row.lifecycleState,
				dependencies: row._count,
			};
		}
		if (kind === "contact") {
			const row = await client.contact.findUnique({
				where: { id },
				select: {
					id: true,
					firstName: true,
					lastName: true,
					version: true,
					lifecycleState: true,
					_count: {
						select: {
							deals: true,
							activities: true,
							emailThreads: true,
							calendarEvents: true,
							contactRoutes: true,
							playerRepresentations: true,
							agentRepresentations: true,
							leads: true,
							operationalTasks: true,
							notes: true,
							proofItems: true,
							facts: true,
						},
					},
				},
			});
			if (!row) throw new NotFoundException("Canonical record was not found.");
			return {
				id: row.id,
				name: [row.firstName, row.lastName].filter(Boolean).join(" "),
				version: row.version,
				lifecycleState: row.lifecycleState,
				dependencies: row._count,
			};
		}
		const row = await client.deal.findUnique({
			where: { id },
			select: {
				id: true,
				name: true,
				version: true,
				lifecycleState: true,
				_count: {
					select: {
						contacts: true,
						activities: true,
						operationalTasks: true,
						notes: true,
						proofItems: true,
						leads: true,
						proposals: true,
					},
				},
			},
		});
		if (!row) throw new NotFoundException("Canonical record was not found.");
		return {
			id: row.id,
			name: row.name,
			version: row.version,
			lifecycleState: row.lifecycleState,
			dependencies: row._count,
		};
	}

	private async dependencyDigest(
		kind: CanonicalKind,
		id: string,
		client: Db | Prisma.TransactionClient,
		dependencies: Record<string, number>,
	) {
		const parentTable = kind;
		const references = await client.$queryRawUnsafe<
			Array<{ childTable: string; childColumn: string }>
		>(
			`SELECT child.relname AS "childTable", child_column.attname AS "childColumn"
			 FROM pg_constraint constraint_row
			 JOIN pg_class parent ON parent.oid = constraint_row.confrelid
			 JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
			 JOIN pg_class child ON child.oid = constraint_row.conrelid
			 JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
			 JOIN unnest(constraint_row.conkey) WITH ORDINALITY AS child_key(attnum, ordinality) ON TRUE
			 JOIN unnest(constraint_row.confkey) WITH ORDINALITY AS parent_key(attnum, ordinality)
			   ON parent_key.ordinality = child_key.ordinality
			 JOIN pg_attribute child_column ON child_column.attrelid = child.oid AND child_column.attnum = child_key.attnum
			 JOIN pg_attribute parent_column ON parent_column.attrelid = parent.oid AND parent_column.attnum = parent_key.attnum
			 WHERE constraint_row.contype = 'f'
			   AND parent_ns.nspname = 'public'
			   AND child_ns.nspname = 'public'
			   AND parent.relname = $1
			   AND parent_column.attname = 'id'
			 ORDER BY child.relname, child_column.attname`,
			parentTable,
		);
		const rows: Record<string, unknown> = {};
		const quote = (identifier: string) =>
			`"${identifier.replaceAll('"', '""')}"`;
		for (const reference of references) {
			const key = `${reference.childTable}.${reference.childColumn}`;
			const result = await client.$queryRawUnsafe<Array<{ rows: unknown }>>(
				`SELECT COALESCE(jsonb_agg(to_jsonb(child) ORDER BY to_jsonb(child)::text), '[]'::jsonb) AS rows
				 FROM ${quote(reference.childTable)} child
				 WHERE ${quote(reference.childColumn)} = $1`,
				id,
			);
			rows[key] = result[0]?.rows ?? [];
		}
		const entityType = kind.toUpperCase();
		for (const table of ["assignment", "allocationRequest", "lifecycleEvent"]) {
			const result = await client.$queryRawUnsafe<Array<{ rows: unknown }>>(
				`SELECT COALESCE(jsonb_agg(to_jsonb(child) ORDER BY to_jsonb(child)::text), '[]'::jsonb) AS rows
				 FROM ${quote(table)} child WHERE "entityType"::text = $1 AND "entityId" = $2`,
				entityType,
				id,
			);
			rows[`${table}.entity`] = result[0]?.rows ?? [];
		}
		return createHmac("sha256", this.secret())
			.update(JSON.stringify({ dependencies, rows }))
			.digest("base64url");
	}

	private sign(payload: Record<string, unknown>) {
		const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
		const signature = createHmac("sha256", this.secret())
			.update(encoded)
			.digest("base64url");
		return `${encoded}.${signature}`;
	}

	private verify(token: string): {
		kind: CanonicalKind;
		id: string;
		confirmationId: string;
		version: number;
		dependencyDigest: string;
		expiresAt: number;
	} {
		const [encoded, supplied] = token.split(".");
		if (!encoded || !supplied)
			throw new ConflictException("The confirmation token is invalid.");
		const expected = createHmac("sha256", this.secret())
			.update(encoded)
			.digest();
		let actual: Buffer;
		try {
			actual = Buffer.from(supplied, "base64url");
		} catch {
			throw new ConflictException("The confirmation token is invalid.");
		}
		if (
			actual.length !== expected.length ||
			!timingSafeEqual(actual, expected)
		) {
			throw new ConflictException("The confirmation token is invalid.");
		}
		const payload = JSON.parse(
			Buffer.from(encoded, "base64url").toString("utf8"),
		);
		if (
			typeof payload !== "object" ||
			payload === null ||
			!["company", "contact", "deal"].includes(payload.kind) ||
			typeof payload.id !== "string" ||
			typeof payload.confirmationId !== "string" ||
			typeof payload.version !== "number" ||
			typeof payload.dependencyDigest !== "string" ||
			typeof payload.expiresAt !== "number" ||
			payload.expiresAt < Date.now()
		) {
			throw new ConflictException(
				"The confirmation token is invalid or expired.",
			);
		}
		return payload;
	}

	private secret() {
		const secret = process.env.BETTER_AUTH_SECRET?.trim();
		if (!secret || secret.length < 32) {
			throw new ConflictException(
				"Destructive confirmation signing is unavailable.",
			);
		}
		return secret;
	}
}
