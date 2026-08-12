import { type Db, type DomainEntityType, Prisma } from "@crm/db";
import { withPrincipal } from "@crm/db/security";
import {
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

const CLAIM = `UPDATE "allocationRequest" SET "status"='LEASED', "leaseOwner"=$1, "leasedUntil"=NOW()+INTERVAL '60 seconds', "attemptCount"="attemptCount"+1, "updatedAt"=NOW() WHERE "id"=(SELECT "id" FROM "allocationRequest" WHERE "status" IN ('PENDING','FAILED','LEASED') AND ("retryAt" IS NULL OR "retryAt"<=NOW()) AND ("leasedUntil" IS NULL OR "leasedUntil"<=NOW()) AND "attemptCount"<"maxAttempts" ORDER BY "createdAt","id" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING "id","entityType","entityId","attemptCount"`;
type Claim = {
	id: string;
	entityType: DomainEntityType;
	entityId: string;
	attemptCount: number;
};
type Context = {
	recordType: string;
	country?: string;
	league?: string;
	language?: string;
};
type AllocationPrefs = {
	allocation?: {
		capacity?: number;
		countries?: string[];
		leagues?: string[];
		languages?: string[];
		recordTypes?: string[];
		adminOptIn?: boolean;
	};
};

@Injectable()
export class AllocationService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async listPolicies(): Promise<
		Array<{ id: string; version: number; name: string; active: boolean }>
	> {
		return this.db.allocationPolicy.findMany({
			orderBy: { version: "desc" },
			take: 100,
			select: { id: true, version: true, name: true, active: true },
		});
	}

	async createPolicy(
		actorUserId: string,
		input: { name: string; rules: object },
	): Promise<{ id: string; version: number; name: string; active: boolean }> {
		return this.db.$transaction(
			async (tx) => {
				const latest = await tx.allocationPolicy.findFirst({
					orderBy: { version: "desc" },
					select: { version: true },
				});
				return tx.allocationPolicy.create({
					data: {
						version: (latest?.version ?? 0) + 1,
						name: input.name,
						rules: input.rules,
						createdByUserId: actorUserId,
					},
					select: { id: true, version: true, name: true, active: true },
				});
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
		);
	}

	activate(
		policyId: string,
	): Promise<{ id: string; version: number; name: string; active: boolean }> {
		return this.db.$transaction(async (tx) => {
			const policy = await tx.allocationPolicy.findUnique({
				where: { id: policyId },
			});
			if (!policy)
				throw new NotFoundException("Allocation policy was not found.");
			await tx.allocationPolicy.updateMany({
				where: { active: true },
				data: { active: false },
			});
			return tx.allocationPolicy.update({
				where: { id: policyId },
				data: { active: true, activatedAt: new Date() },
				select: { id: true, version: true, name: true, active: true },
			});
		});
	}

	async preview(entityType: DomainEntityType, entityId: string) {
		return this.evaluate(this.db, entityType, entityId);
	}

	private async evaluate(
		db: Db | Prisma.TransactionClient,
		entityType: DomainEntityType,
		entityId: string,
	) {
		const policy = await db.allocationPolicy.findFirst({
			where: { active: true },
			orderBy: { version: "desc" },
		});
		if (!policy)
			return {
				assignee: null,
				explanation: { eligible: false, reason: "NO_ACTIVE_POLICY" },
			};
		const context = await this.context(db, entityType, entityId);
		const rules = policy.rules as {
			priorityUserIds?: string[];
			defaultCapacity?: number;
		};
		const members = await db.member.findMany({
			where: {
				organizationId: "workspace",
				role: { in: ["admin", "team", "contributor"] },
				user: { profile: { status: "ACTIVE" } },
			},
			select: {
				userId: true,
				role: true,
				user: {
					select: {
						name: true,
						email: true,
						profile: {
							select: { preferredLanguage: true, workingPreferences: true },
						},
					},
				},
			},
		});
		const activeLoads = await db.assignment.groupBy({
			by: ["assigneeUserId"],
			where: { revokedAt: null },
			_count: { _all: true },
		});
		const load = new Map(
			activeLoads.map((row) => [row.assigneeUserId, row._count._all]),
		);
		const evaluated = await Promise.all(
			members.map(async (member) => {
				const prefs = (member.user.profile?.workingPreferences ??
					{}) as AllocationPrefs;
				const allocation = prefs.allocation ?? {};
				const capacity = Math.max(
					1,
					allocation.capacity ?? rules.defaultCapacity ?? 25,
				);
				const reasons: string[] = [];
				if (member.role === "admin" && !allocation.adminOptIn)
					reasons.push("ADMIN_NOT_OPTED_IN");
				if (
					allocation.recordTypes?.length &&
					!allocation.recordTypes.includes(context.recordType)
				)
					reasons.push("RECORD_TYPE");
				if (
					context.country &&
					allocation.countries?.length &&
					!allocation.countries.includes(context.country)
				)
					reasons.push("COUNTRY");
				if (
					context.league &&
					allocation.leagues?.length &&
					!allocation.leagues.includes(context.league)
				)
					reasons.push("LEAGUE");
				if (
					context.language &&
					allocation.languages?.length &&
					!allocation.languages.includes(context.language)
				)
					reasons.push("LANGUAGE");
				const currentLoad = load.get(member.userId) ?? 0;
				if (currentLoad >= capacity) reasons.push("CAPACITY");
				const last = await db.assignment.findFirst({
					where: { assigneeUserId: member.userId },
					orderBy: { assignedAt: "desc" },
					select: { assignedAt: true },
				});
				return {
					userId: member.userId,
					name: member.user.name,
					email: member.user.email,
					capacity,
					activeLoad: currentLoad,
					loadRatio: currentLoad / capacity,
					lastAssignedAt: last?.assignedAt ?? null,
					eligible: reasons.length === 0,
					excludedBy: reasons,
				};
			}),
		);
		const priority = rules.priorityUserIds ?? [];
		const eligible = evaluated
			.filter((row) => row.eligible)
			.sort((a, b) => {
				const pa = priority.indexOf(a.userId);
				const pb = priority.indexOf(b.userId);
				const ar = pa < 0 ? Number.MAX_SAFE_INTEGER : pa;
				const br = pb < 0 ? Number.MAX_SAFE_INTEGER : pb;
				return (
					ar - br ||
					a.loadRatio - b.loadRatio ||
					(a.lastAssignedAt?.getTime() ?? 0) -
						(b.lastAssignedAt?.getTime() ?? 0) ||
					a.userId.localeCompare(b.userId)
				);
			});
		return {
			assignee: eligible[0] ?? null,
			explanation: {
				eligible: Boolean(eligible[0]),
				policyId: policy.id,
				policyVersion: policy.version,
				context,
				candidates: evaluated,
			},
		};
	}

	async overview(): Promise<{
		unallocated: Array<{
			id: string;
			entityType: DomainEntityType;
			label: string;
			status: string;
			reason: string;
			attempts: number;
			updatedAt: Date;
		}>;
		workload: Array<{
			userId: string;
			name: string;
			email: string;
			role: string;
			activeLoad: number;
		}>;
	}> {
		const [requests, members, loads] = await Promise.all([
			this.db.allocationRequest.findMany({
				where: { status: { in: ["UNALLOCATED", "FAILED", "DEAD"] } },
				orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
				take: 100,
				select: {
					id: true,
					entityType: true,
					entityId: true,
					status: true,
					explanation: true,
					lastErrorCode: true,
					attemptCount: true,
					updatedAt: true,
				},
			}),
			this.db.member.findMany({
				where: {
					organizationId: "workspace",
					role: { in: ["admin", "team", "contributor"] },
					user: { profile: { status: "ACTIVE" } },
				},
				select: {
					userId: true,
					role: true,
					user: { select: { name: true, email: true } },
				},
				orderBy: { user: { name: "asc" } },
			}),
			this.db.assignment.groupBy({
				by: ["assigneeUserId"],
				where: { revokedAt: null },
				_count: { _all: true },
			}),
		]);
		const loadByUser = new Map(
			loads.map((row) => [row.assigneeUserId, row._count._all]),
		);
		const unallocated = await Promise.all(
			requests.map(async (request) => ({
				id: request.id,
				entityType: request.entityType,
				label: await this.targetLabel(request.entityType, request.entityId),
				status: request.status,
				reason:
					request.lastErrorCode ?? this.explanationReason(request.explanation),
				attempts: request.attemptCount,
				updatedAt: request.updatedAt,
			})),
		);
		return {
			unallocated,
			workload: members.map((member) => ({
				userId: member.userId,
				name: member.user.name,
				email: member.user.email,
				role: member.role,
				activeLoad: loadByUser.get(member.userId) ?? 0,
			})),
		};
	}

	private explanationReason(value: Prisma.JsonValue | null): string {
		if (
			value &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			"reason" in value &&
			typeof value.reason === "string"
		)
			return value.reason;
		return "NO_ELIGIBLE_RECIPIENT";
	}

	private async targetLabel(
		entityType: DomainEntityType,
		entityId: string,
	): Promise<string> {
		if (["CONTACT", "PLAYER", "FOOTBALL_AGENT"].includes(entityType)) {
			const row = await this.db.contact.findUnique({
				where: { id: entityId },
				select: { firstName: true, lastName: true },
			});
			return row
				? [row.firstName, row.lastName].filter(Boolean).join(" ")
				: "Archived or unavailable contact";
		}
		if (["COMPANY", "AGENCY", "CLUB"].includes(entityType)) {
			return (
				(
					await this.db.company.findUnique({
						where: { id: entityId },
						select: { name: true },
					})
				)?.name ?? "Archived or unavailable company"
			);
		}
		if (entityType === "LEAD")
			return (
				(
					await this.db.lead.findUnique({
						where: { id: entityId },
						select: { name: true },
					})
				)?.name ?? "Unavailable lead"
			);
		return (
			(
				await this.db.deal.findUnique({
					where: { id: entityId },
					select: { name: true },
				})
			)?.name ?? "Archived or unavailable deal"
		);
	}
	async enqueue(
		actorUserId: string,
		input: {
			entityType: DomainEntityType;
			entityId: string;
			idempotencyKey: string;
		},
	): Promise<{ id: string; status: string }> {
		return this.db.allocationRequest.upsert({
			where: { idempotencyKey: input.idempotencyKey },
			create: { ...input, requestedByUserId: actorUserId },
			update: {},
			select: { id: true, status: true },
		});
	}

	async override(
		actorUserId: string,
		input: {
			entityType: DomainEntityType;
			entityId: string;
			assigneeUserId: string;
			reason: string;
		},
	) {
		await this.assertEligibleMember(input.assigneeUserId);
		return this.db.$transaction(async (tx) => {
			await tx.assignment.updateMany({
				where: {
					entityType: input.entityType,
					entityId: input.entityId,
					revokedAt: null,
				},
				data: { revokedAt: new Date() },
			});
			const assignment = await tx.assignment.create({
				data: {
					entityType: input.entityType,
					entityId: input.entityId,
					assigneeUserId: input.assigneeUserId,
					assignedByUserId: actorUserId,
					reason: input.reason,
				},
			});
			await tx.lifecycleEvent.create({
				data: {
					entityType: input.entityType,
					entityId: input.entityId,
					toState: "MANUALLY_ASSIGNED",
					actorUserId,
					reason: input.reason,
					metadata: { assigneeUserId: input.assigneeUserId },
				},
			});
			return assignment;
		});
	}

	async runDue(workerId: string) {
		let processed = 0;
		for (let i = 0; i < 25; i += 1) {
			const rows = await withPrincipal(
				this.db,
				{ userId: null, kind: "worker" },
				(tx) => tx.$queryRawUnsafe<Claim[]>(CLAIM, workerId),
			);
			const job = rows[0];
			if (!job) break;
			try {
				await this.apply(job, workerId);
			} catch (error) {
				await this.fail(job, workerId, error);
			}
			processed += 1;
		}
		return processed;
	}

	private async apply(job: Claim, workerId: string) {
		await withPrincipal(
			this.db,
			{ userId: null, kind: "worker" },
			async (tx) => {
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ibl-allocation-engine'))`;
				const request = await tx.allocationRequest.findFirst({
					where: { id: job.id, leaseOwner: workerId, status: "LEASED" },
				});
				if (!request) throw new ConflictException("Allocation lease was lost.");
				const result = await this.evaluate(tx, job.entityType, job.entityId);
				if (!result.assignee) {
					await tx.allocationRequest.update({
						where: { id: job.id },
						data: {
							status: "UNALLOCATED",
							explanation: result.explanation,
							leaseOwner: null,
							leasedUntil: null,
						},
					});
					return;
				}
				const policyVersion = result.explanation.policyVersion;
				await tx.assignment.updateMany({
					where: {
						entityType: job.entityType,
						entityId: job.entityId,
						revokedAt: null,
					},
					data: { revokedAt: new Date() },
				});
				await tx.assignment.create({
					data: {
						entityType: job.entityType,
						entityId: job.entityId,
						assigneeUserId: result.assignee.userId,
						assignedByUserId: null,
						reason: `Allocation policy v${policyVersion}`,
					},
				});
				await tx.allocationRequest.update({
					where: { id: job.id },
					data: {
						status: "ALLOCATED",
						assigneeUserId: result.assignee.userId,
						policyVersion,
						explanation: result.explanation,
						leaseOwner: null,
						leasedUntil: null,
					},
				});
			},
		);
	}
	private async fail(job: Claim, workerId: string, error: unknown) {
		const dead = job.attemptCount >= 5;
		await withPrincipal(this.db, { userId: null, kind: "worker" }, (tx) =>
			tx.allocationRequest.updateMany({
				where: { id: job.id, leaseOwner: workerId },
				data: {
					status: dead ? "DEAD" : "FAILED",
					leaseOwner: null,
					leasedUntil: null,
					retryAt: dead
						? null
						: new Date(
								Date.now() + Math.min(3600000, 15000 * 2 ** job.attemptCount),
							),
					lastErrorCode:
						error instanceof Error
							? error.message.slice(0, 100)
							: "ALLOCATION_FAILED",
				},
			}),
		);
	}

	private async assertEligibleMember(userId: string) {
		const member = await this.db.member.findFirst({
			where: {
				organizationId: "workspace",
				userId,
				role: { in: ["team", "contributor", "admin"] },
				user: { profile: { status: "ACTIVE" } },
			},
		});
		if (!member)
			throw new ConflictException("Assignee is not an active eligible member.");
	}

	private async context(
		db: Db | Prisma.TransactionClient,
		entityType: DomainEntityType,
		entityId: string,
	): Promise<Context> {
		if (
			entityType === "CONTACT" ||
			entityType === "PLAYER" ||
			entityType === "FOOTBALL_AGENT"
		) {
			const row = await db.contact.findUnique({
				where: { id: entityId },
				select: {
					lifecycleState: true,
					company: {
						select: {
							countryCode: true,
							clubProfile: { select: { league: true } },
						},
					},
					playerProfile: {
						select: {
							nationality: true,
							currentClub: { select: { league: true } },
						},
					},
				},
			});
			if (!row || row.lifecycleState !== "ACTIVE")
				throw new NotFoundException("Active allocation target was not found.");
			return {
				recordType: entityType,
				country:
					row.playerProfile?.nationality ??
					row.company?.countryCode ??
					undefined,
				league:
					row.playerProfile?.currentClub?.league ??
					row.company?.clubProfile?.league ??
					undefined,
			};
		}
		if (
			entityType === "COMPANY" ||
			entityType === "AGENCY" ||
			entityType === "CLUB"
		) {
			const row = await db.company.findUnique({
				where: { id: entityId },
				select: {
					lifecycleState: true,
					countryCode: true,
					clubProfile: { select: { league: true } },
				},
			});
			if (!row || row.lifecycleState !== "ACTIVE")
				throw new NotFoundException("Active allocation target was not found.");
			return {
				recordType: entityType,
				country: row.countryCode ?? undefined,
				league: row.clubProfile?.league ?? undefined,
			};
		}
		const exists =
			entityType === "LEAD"
				? await db.lead.findUnique({
						where: { id: entityId },
						select: { id: true },
					})
				: await db.deal.findUnique({
						where: { id: entityId },
						select: { id: true, lifecycleState: true },
					});
		if (
			!exists ||
			("lifecycleState" in exists && exists.lifecycleState !== "ACTIVE")
		)
			throw new NotFoundException("Active allocation target was not found.");
		return { recordType: entityType };
	}
}
