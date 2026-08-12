import { type Db, Prisma } from "@crm/db";
import {
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

const DETECTOR_VERSION = "ibl-football-review-v2";
type Entity = "CONTACT" | "COMPANY";
type Choice = "left" | "right";
type MergeResult = {
	id: string;
	status: string;
	survivorEntityId: string;
	duplicateEntityId: string;
};
type DuplicateDisplay = {
	label: string;
	fields: Record<string, string | null>;
	relationshipCounts: Record<string, number>;
};
type DuplicatePreview = {
	candidate: {
		id: string;
		entityType: Entity;
		score: number;
		reasons: string[];
		detectorVersion: string;
	};
	left: DuplicateDisplay;
	right: DuplicateDisplay;
};

@Injectable()
export class DuplicateService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async detectContact(id: string) {
		const row = await this.db.contact.findUnique({
			where: { id },
			select: {
				id: true,
				firstName: true,
				lastName: true,
				email: true,
				companyId: true,
				version: true,
				lifecycleState: true,
				playerProfile: {
					select: { dateOfBirth: true, currentClubId: true, sourceKey: true },
				},
				footballAgentProfile: {
					select: {
						licenseNumber: true,
						licenseCountry: true,
						agencyId: true,
						sourceKey: true,
					},
				},
			},
		});
		if (!row || row.lifecycleState !== "ACTIVE") return [];
		const name = `${row.firstName} ${row.lastName ?? ""}`.trim();
		const peers = await this.db.contact.findMany({
			where: {
				id: { not: id },
				lifecycleState: "ACTIVE",
				OR: [
					...(row.email
						? [{ email: { equals: row.email, mode: "insensitive" as const } }]
						: []),
					...(row.playerProfile?.sourceKey
						? [{ playerProfile: { sourceKey: row.playerProfile.sourceKey } }]
						: []),
					...(row.footballAgentProfile?.sourceKey
						? [
								{
									footballAgentProfile: {
										sourceKey: row.footballAgentProfile.sourceKey,
									},
								},
							]
						: []),
					...(row.footballAgentProfile?.licenseNumber
						? [
								{
									footballAgentProfile: {
										licenseNumber: {
											equals: row.footballAgentProfile.licenseNumber,
											mode: "insensitive" as const,
										},
									},
								},
							]
						: []),
					{
						firstName: { equals: row.firstName, mode: "insensitive" },
						lastName: row.lastName
							? { equals: row.lastName, mode: "insensitive" }
							: null,
					},
				],
			},
			select: {
				id: true,
				firstName: true,
				lastName: true,
				email: true,
				companyId: true,
				version: true,
				playerProfile: {
					select: { dateOfBirth: true, currentClubId: true, sourceKey: true },
				},
				footballAgentProfile: {
					select: {
						licenseNumber: true,
						licenseCountry: true,
						agencyId: true,
						sourceKey: true,
					},
				},
			},
			take: 50,
		});
		return Promise.all(
			peers.map((peer) => {
				const exactEmail = Boolean(
					row.email &&
						peer.email &&
						row.email.trim().toLowerCase() === peer.email.trim().toLowerCase(),
				);
				const exactLicense = Boolean(
					row.footballAgentProfile?.licenseNumber &&
						peer.footballAgentProfile?.licenseNumber &&
						row.footballAgentProfile.licenseNumber.trim().toLowerCase() ===
							peer.footballAgentProfile.licenseNumber.trim().toLowerCase() &&
						row.footballAgentProfile.licenseCountry ===
							peer.footballAgentProfile.licenseCountry,
				);
				const exactSourceKey = Boolean(
					(row.playerProfile?.sourceKey &&
						row.playerProfile.sourceKey === peer.playerProfile?.sourceKey) ||
						(row.footballAgentProfile?.sourceKey &&
							row.footballAgentProfile.sourceKey ===
								peer.footballAgentProfile?.sourceKey),
				);
				const sameCompany = Boolean(
					row.companyId && row.companyId === peer.companyId,
				);
				const sameName =
					name.toLowerCase() ===
					`${peer.firstName} ${peer.lastName ?? ""}`.trim().toLowerCase();
				const sameDateOfBirth = Boolean(
					row.playerProfile?.dateOfBirth &&
						peer.playerProfile?.dateOfBirth &&
						row.playerProfile.dateOfBirth.getTime() ===
							peer.playerProfile.dateOfBirth.getTime(),
				);
				const sameClub = Boolean(
					row.playerProfile?.currentClubId &&
						row.playerProfile.currentClubId ===
							peer.playerProfile?.currentClubId,
				);
				const sameAgency = Boolean(
					row.footballAgentProfile?.agencyId &&
						row.footballAgentProfile.agencyId ===
							peer.footballAgentProfile?.agencyId,
				);
				return this.upsert(
					"CONTACT",
					row.id,
					row.version,
					peer.id,
					peer.version,
					{
						exactEmail,
						exactLicense,
						exactSourceKey,
						sameName,
						sameCompany,
						sameDateOfBirth,
						sameClub,
						sameAgency,
					},
				);
			}),
		);
	}

	async detectCompany(id: string) {
		const row = await this.db.company.findUnique({
			where: { id },
			select: {
				id: true,
				name: true,
				domain: true,
				countryCode: true,
				version: true,
				lifecycleState: true,
				agencyProfile: { select: { registrationId: true, sourceKey: true } },
				clubProfile: {
					select: { association: true, league: true, sourceKey: true },
				},
			},
		});
		if (!row || row.lifecycleState !== "ACTIVE") return [];
		const peers = await this.db.company.findMany({
			where: {
				id: { not: id },
				lifecycleState: "ACTIVE",
				OR: [
					...(row.domain
						? [{ domain: { equals: row.domain, mode: "insensitive" as const } }]
						: []),
					...(row.agencyProfile?.sourceKey
						? [{ agencyProfile: { sourceKey: row.agencyProfile.sourceKey } }]
						: []),
					...(row.clubProfile?.sourceKey
						? [{ clubProfile: { sourceKey: row.clubProfile.sourceKey } }]
						: []),
					...(row.agencyProfile?.registrationId
						? [
								{
									agencyProfile: {
										registrationId: {
											equals: row.agencyProfile.registrationId,
											mode: "insensitive" as const,
										},
									},
								},
							]
						: []),
					{ name: { equals: row.name, mode: "insensitive" } },
				],
			},
			select: {
				id: true,
				name: true,
				domain: true,
				countryCode: true,
				version: true,
				agencyProfile: { select: { registrationId: true, sourceKey: true } },
				clubProfile: {
					select: { association: true, league: true, sourceKey: true },
				},
			},
			take: 50,
		});
		return Promise.all(
			peers.map((peer) =>
				this.upsert("COMPANY", row.id, row.version, peer.id, peer.version, {
					exactDomain: Boolean(
						row.domain &&
							peer.domain &&
							row.domain.trim().toLowerCase() ===
								peer.domain.trim().toLowerCase(),
					),
					exactRegistration: Boolean(
						row.agencyProfile?.registrationId &&
							peer.agencyProfile?.registrationId &&
							row.agencyProfile.registrationId.trim().toLowerCase() ===
								peer.agencyProfile.registrationId.trim().toLowerCase(),
					),
					exactSourceKey: Boolean(
						(row.agencyProfile?.sourceKey &&
							row.agencyProfile.sourceKey === peer.agencyProfile?.sourceKey) ||
							(row.clubProfile?.sourceKey &&
								row.clubProfile.sourceKey === peer.clubProfile?.sourceKey),
					),
					sameName:
						row.name.trim().toLowerCase() === peer.name.trim().toLowerCase(),
					sameCountry: Boolean(
						row.countryCode && row.countryCode === peer.countryCode,
					),
					sameLeague: Boolean(
						row.clubProfile?.league &&
							row.clubProfile.league === peer.clubProfile?.league,
					),
					sameAssociation: Boolean(
						row.clubProfile?.association &&
							row.clubProfile.association === peer.clubProfile?.association,
					),
				}),
			),
		);
	}
	private upsert(
		entityType: Entity,
		a: string,
		av: number,
		b: string,
		bv: number,
		components: Record<string, boolean>,
	) {
		const ordered = [a, b].sort();
		const leftEntityId = ordered[0]!;
		const rightEntityId = ordered[1]!;
		const [leftVersion, rightVersion] =
			leftEntityId === a ? [av, bv] : [bv, av];
		const exact =
			components.exactEmail ||
			components.exactDomain ||
			components.exactLicense ||
			components.exactRegistration ||
			components.exactSourceKey;
		const score = exact
			? 1
			: Math.min(0.95, Object.values(components).filter(Boolean).length * 0.3);
		const reasons = Object.entries(components)
			.filter(([, value]) => value)
			.map(([key]) => key);
		return this.db.duplicateCandidate.upsert({
			where: {
				entityType_leftEntityId_rightEntityId: {
					entityType,
					leftEntityId,
					rightEntityId,
				},
			},
			create: {
				entityType,
				leftEntityId,
				rightEntityId,
				leftVersion,
				rightVersion,
				score,
				reasons,
				scoreComponents: components,
				detectorVersion: DETECTOR_VERSION,
			},
			update: {
				leftVersion,
				rightVersion,
				score,
				reasons,
				scoreComponents: components,
				detectorVersion: DETECTOR_VERSION,
			},
		});
	}

	async list(input: { q: string; take: number }) {
		const rows = await this.db.duplicateCandidate.findMany({
			where: { status: "OPEN" },
			orderBy: [{ score: "desc" }, { createdAt: "asc" }],
			take: input.take,
		});
		return Promise.all(
			rows.map(async (candidate) => ({
				id: candidate.id,
				entityType: candidate.entityType,
				score: candidate.score,
				reasons: candidate.reasons,
				detectorVersion: candidate.detectorVersion,
				left: await this.label(
					candidate.entityType as Entity,
					candidate.leftEntityId,
				),
				right: await this.label(
					candidate.entityType as Entity,
					candidate.rightEntityId,
				),
			})),
		).then((items) =>
			input.q
				? items.filter((item) =>
						`${item.left.label} ${item.right.label}`
							.toLowerCase()
							.includes(input.q.toLowerCase()),
					)
				: items,
		);
	}

	async preview(candidateId: string): Promise<DuplicatePreview> {
		const candidate = await this.db.duplicateCandidate.findUnique({
			where: { id: candidateId },
			select: {
				id: true,
				entityType: true,
				score: true,
				reasons: true,
				detectorVersion: true,
				leftEntityId: true,
				rightEntityId: true,
			},
		});
		if (!candidate)
			throw new NotFoundException("Duplicate candidate was not found.");
		const type = candidate.entityType as Entity;
		return {
			candidate: {
				id: candidate.id,
				entityType: type,
				score: Number(candidate.score),
				reasons: Array.isArray(candidate.reasons)
					? candidate.reasons.filter(
							(value): value is string => typeof value === "string",
						)
					: [],
				detectorVersion: candidate.detectorVersion,
			},
			left: await this.displaySnapshot(type, candidate.leftEntityId),
			right: await this.displaySnapshot(type, candidate.rightEntityId),
		};
	}

	async dismiss(candidateId: string, actorUserId: string, reason: string) {
		const result = await this.db.duplicateCandidate.updateMany({
			where: { id: candidateId, status: "OPEN" },
			data: {
				status: "DISMISSED",
				reviewedById: actorUserId,
				reviewedAt: new Date(),
			},
		});
		if (result.count !== 1)
			throw new ConflictException("This candidate has already been reviewed.");
		await this.db.securityAuditEvent.create({
			data: {
				actorUserId,
				action: "DUPLICATE_DISMISSED",
				resourceType: "DuplicateCandidate",
				resourceId: candidateId,
				outcome: "ALLOWED",
				metadata: { reason },
			},
		});
		return { id: candidateId, status: "DISMISSED" as const };
	}

	async merge(
		input: {
			candidateId: string;
			survivorSide: Choice;
			reason: string;
			idempotencyKey: string;
			fieldChoices: Record<string, Choice>;
		},
		actorUserId: string,
	): Promise<MergeResult> {
		return this.db.$transaction(
			async (tx) => {
				const replay = await tx.mergeDecision.findUnique({
					where: { idempotencyKey: input.idempotencyKey },
					select: {
						id: true,
						status: true,
						survivorEntityId: true,
						duplicateEntityId: true,
					},
				});
				if (replay) return replay;
				const candidate = await tx.duplicateCandidate.findUnique({
					where: { id: input.candidateId },
				});
				if (!candidate || candidate.status !== "OPEN")
					throw new ConflictException("This candidate is no longer open.");
				const type = candidate.entityType as Entity;
				const survivorId =
					input.survivorSide === "left"
						? candidate.leftEntityId
						: candidate.rightEntityId;
				const duplicateId =
					input.survivorSide === "left"
						? candidate.rightEntityId
						: candidate.leftEntityId;
				await tx.$queryRaw(
					Prisma.sql`SELECT id FROM "duplicateCandidate" WHERE id = ${candidate.id} FOR UPDATE`,
				);
				if (type === "CONTACT")
					await tx.$queryRaw(
						Prisma.sql`SELECT id FROM "contact" WHERE id IN (${candidate.leftEntityId}, ${candidate.rightEntityId}) ORDER BY id FOR UPDATE`,
					);
				else
					await tx.$queryRaw(
						Prisma.sql`SELECT id FROM "company" WHERE id IN (${candidate.leftEntityId}, ${candidate.rightEntityId}) ORDER BY id FOR UPDATE`,
					);
				const left = await this.snapshotTx(tx, type, candidate.leftEntityId);
				const right = await this.snapshotTx(tx, type, candidate.rightEntityId);
				if (
					left.version !== candidate.leftVersion ||
					right.version !== candidate.rightVersion
				)
					throw new ConflictException(
						"A record changed after detection. Re-run duplicate detection.",
					);
				await this.assertNoFieldConflicts(tx, type, survivorId, duplicateId);
				if (type === "CONTACT")
					await this.mergeContact(tx, survivorId, duplicateId);
				else await this.mergeCompany(tx, survivorId, duplicateId);
				const selected = input.survivorSide === "left" ? left : right;
				const other = input.survivorSide === "left" ? right : left;
				const allowed =
					type === "CONTACT"
						? [
								"firstName",
								"lastName",
								"email",
								"phone",
								"title",
								"linkedinUrl",
								"twitterUrl",
								"githubUrl",
								"imageUrl",
								"companyId",
								"ownerId",
							]
						: [
								"name",
								"domain",
								"website",
								"description",
								"industry",
								"city",
								"country",
								"countryCode",
								"phone",
								"email",
								"linkedinUrl",
								"ownerId",
							];
				const chosen: Record<string, unknown> = {};
				for (const field of allowed)
					chosen[field] =
						input.fieldChoices[field] ===
						(input.survivorSide === "left" ? "right" : "left")
							? other[field]
							: selected[field];
				if (type === "CONTACT")
					await tx.contact.update({
						where: { id: survivorId },
						data: { ...chosen, version: { increment: 1 } },
					});
				else
					await tx.company.update({
						where: { id: survivorId },
						data: { ...chosen, version: { increment: 1 } },
					});
				const archived = {
					lifecycleState: "ARCHIVED" as const,
					archivedAt: new Date(),
					archivedByUserId: actorUserId,
					archiveReason: `Merged into ${survivorId}: ${input.reason}`,
					version: { increment: 1 },
				};
				if (type === "CONTACT")
					await tx.contact.update({
						where: { id: duplicateId },
						data: archived,
					});
				else
					await tx.company.update({
						where: { id: duplicateId },
						data: archived,
					});
				await tx.canonicalAlias.create({
					data: {
						entityType: type,
						aliasEntityId: duplicateId,
						survivorEntityId: survivorId,
						createdByUserId: actorUserId,
						reason: input.reason,
					},
				});
				await tx.canonicalTombstone.create({
					data: {
						entityType: type,
						entityId: duplicateId,
						survivorEntityId: survivorId,
						kind: "MERGE",
						snapshot: other,
						createdByUserId: actorUserId,
						reason: input.reason,
					},
				});
				const decision = await tx.mergeDecision.create({
					data: {
						candidateId: candidate.id,
						survivorEntityId: survivorId,
						duplicateEntityId: duplicateId,
						decidedByUserId: actorUserId,
						reason: input.reason,
						fieldChoices: input.fieldChoices,
						snapshot: { left, right },
						idempotencyKey: input.idempotencyKey,
						status: "APPLIED",
						appliedAt: new Date(),
					},
					select: {
						id: true,
						status: true,
						survivorEntityId: true,
						duplicateEntityId: true,
					},
				});
				await tx.duplicateCandidate.update({
					where: { id: candidate.id },
					data: {
						status: "MERGED",
						reviewedById: actorUserId,
						reviewedAt: new Date(),
					},
				});
				await tx.duplicateCandidate.updateMany({
					where: {
						id: { not: candidate.id },
						status: "OPEN",
						OR: [{ leftEntityId: duplicateId }, { rightEntityId: duplicateId }],
					},
					data: {
						status: "DISMISSED",
						reviewedById: actorUserId,
						reviewedAt: new Date(),
					},
				});
				await tx.lifecycleEvent.createMany({
					data: [
						{
							entityType: type,
							entityId: duplicateId,
							fromState: "ACTIVE",
							toState: "ARCHIVED",
							actorUserId,
							reason: input.reason,
							metadata: {
								survivorEntityId: survivorId,
								mergeDecisionId: decision.id,
							},
						},
						{
							entityType: type,
							entityId: survivorId,
							toState: "MERGED_SURVIVOR",
							actorUserId,
							reason: input.reason,
							metadata: {
								duplicateEntityId: duplicateId,
								mergeDecisionId: decision.id,
							},
						},
					],
				});
				return decision;
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
		);
	}

	private async assertNoFieldConflicts(
		tx: Prisma.TransactionClient,
		type: Entity,
		survivorId: string,
		duplicateId: string,
	) {
		const conflict =
			type === "CONTACT"
				? await tx.fieldValue.findFirst({
						where: {
							contactId: survivorId,
							fieldId: {
								in: (
									await tx.fieldValue.findMany({
										where: { contactId: duplicateId },
										select: { fieldId: true },
									})
								).map((r) => r.fieldId),
							},
						},
					})
				: await tx.fieldValue.findFirst({
						where: {
							companyId: survivorId,
							fieldId: {
								in: (
									await tx.fieldValue.findMany({
										where: { companyId: duplicateId },
										select: { fieldId: true },
									})
								).map((r) => r.fieldId),
							},
						},
					});
		if (conflict)
			throw new ConflictException(
				"Custom-field conflicts require explicit resolution before merge.",
			);
	}

	private async mergeContact(
		tx: Prisma.TransactionClient,
		survivor: string,
		duplicate: string,
	) {
		const [survivorPlayer, duplicatePlayer, survivorAgent, duplicateAgent] =
			await Promise.all([
				tx.footballPlayer.findUnique({
					where: { contactId: survivor },
					select: { contactId: true },
				}),
				tx.footballPlayer.findUnique({
					where: { contactId: duplicate },
					select: { contactId: true },
				}),
				tx.footballAgent.findUnique({
					where: { contactId: survivor },
					select: { contactId: true },
				}),
				tx.footballAgent.findUnique({
					where: { contactId: duplicate },
					select: { contactId: true },
				}),
			]);
		if (survivorPlayer && duplicatePlayer)
			throw new ConflictException(
				"Both contacts have player profiles; choose profile fields before merging.",
			);
		if (survivorAgent && duplicateAgent)
			throw new ConflictException(
				"Both contacts have football-agent profiles; choose profile fields before merging.",
			);
		if (duplicatePlayer)
			await tx.footballPlayer.update({
				where: { contactId: duplicate },
				data: { contactId: survivor },
			});
		if (duplicateAgent)
			await tx.footballAgent.update({
				where: { contactId: duplicate },
				data: { contactId: survivor },
			});
		await tx.$executeRaw(
			Prisma.sql`INSERT INTO "dealContact" ("dealId","contactId","role") SELECT "dealId", ${survivor}, "role" FROM "dealContact" WHERE "contactId"=${duplicate} ON CONFLICT ("dealId","contactId") DO NOTHING`,
		);
		await tx.dealContact.deleteMany({ where: { contactId: duplicate } });
		for (const model of [
			tx.contactFact,
			tx.activity,
			tx.emailThread,
			tx.calendarEvent,
			tx.contactRoute,
			tx.sharedRoutePolicy,
			tx.lead,
			tx.operationalTask,
			tx.note,
			tx.proofItem,
		] as const)
			await (model as any).updateMany({
				where:
					model === tx.sharedRoutePolicy
						? { granteeContactId: duplicate }
						: { contactId: duplicate },
				data:
					model === tx.sharedRoutePolicy
						? { granteeContactId: survivor }
						: { contactId: survivor },
			});
		await tx.fieldValue.updateMany({
			where: { contactId: duplicate },
			data: { contactId: survivor },
		});
		await tx.representation.updateMany({
			where: { playerContactId: duplicate },
			data: { playerContactId: survivor },
		});
		await tx.representation.updateMany({
			where: { agentContactId: duplicate },
			data: { agentContactId: survivor },
		});
		await tx.company.updateMany({
			where: { primaryContactId: duplicate },
			data: { primaryContactId: survivor },
		});
		await tx.contactRouteConsent.updateMany({
			where: { contactId: duplicate },
			data: { contactId: survivor },
		});
		await tx.followUpPlan.updateMany({
			where: { contactId: duplicate },
			data: { contactId: survivor },
		});
		await tx.assignment.updateMany({
			where: { entityType: "CONTACT", entityId: duplicate },
			data: { entityId: survivor },
		});
		await tx.allocationRequest.updateMany({
			where: { entityType: "CONTACT", entityId: duplicate },
			data: { entityId: survivor },
		});
	}

	private async mergeCompany(
		tx: Prisma.TransactionClient,
		survivor: string,
		duplicate: string,
	) {
		const [survivorAgency, duplicateAgency, survivorClub, duplicateClub] =
			await Promise.all([
				tx.agency.findUnique({
					where: { companyId: survivor },
					select: { companyId: true },
				}),
				tx.agency.findUnique({
					where: { companyId: duplicate },
					select: { companyId: true },
				}),
				tx.club.findUnique({
					where: { companyId: survivor },
					select: { companyId: true },
				}),
				tx.club.findUnique({
					where: { companyId: duplicate },
					select: { companyId: true },
				}),
			]);
		if (survivorAgency && duplicateAgency)
			throw new ConflictException(
				"Both companies have agency profiles; resolve the profile conflict before merging.",
			);
		if (survivorClub && duplicateClub)
			throw new ConflictException(
				"Both companies have club profiles; resolve the profile conflict before merging.",
			);
		if (duplicateAgency)
			await tx.agency.update({
				where: { companyId: duplicate },
				data: { companyId: survivor },
			});
		if (duplicateClub)
			await tx.club.update({
				where: { companyId: duplicate },
				data: { companyId: survivor },
			});
		for (const model of [
			tx.contact,
			tx.deal,
			tx.activity,
			tx.emailThread,
			tx.calendarEvent,
			tx.contactRoute,
			tx.sharedRoutePolicy,
			tx.representation,
			tx.lead,
			tx.operationalTask,
			tx.note,
			tx.proofItem,
		] as const) {
			const key =
				model === tx.sharedRoutePolicy
					? "granteeCompanyId"
					: model === tx.representation
						? "agencyCompanyId"
						: "companyId";
			await (model as any).updateMany({
				where: { [key]: duplicate },
				data: { [key]: survivor },
			});
		}
		await tx.fieldValue.updateMany({
			where: { companyId: duplicate },
			data: { companyId: survivor },
		});
		await tx.assignment.updateMany({
			where: { entityType: "COMPANY", entityId: duplicate },
			data: { entityId: survivor },
		});
		await tx.allocationRequest.updateMany({
			where: { entityType: "COMPANY", entityId: duplicate },
			data: { entityId: survivor },
		});
	}

	private async displaySnapshot(
		type: Entity,
		id: string,
	): Promise<DuplicateDisplay> {
		if (type === "CONTACT") {
			const row = await this.db.contact.findUnique({
				where: { id },
				select: {
					firstName: true,
					lastName: true,
					email: true,
					phone: true,
					title: true,
					linkedinUrl: true,
					twitterUrl: true,
					githubUrl: true,
					companyId: true,
					company: { select: { name: true } },
					ownerId: true,
					owner: { select: { name: true } },
					_count: {
						select: {
							deals: true,
							activities: true,
							contactRoutes: true,
							playerRepresentations: true,
							agentRepresentations: true,
							leads: true,
							operationalTasks: true,
							notes: true,
							proofItems: true,
						},
					},
				},
			});
			if (!row)
				throw new NotFoundException("A duplicate record no longer exists.");
			return {
				label: [row.firstName, row.lastName].filter(Boolean).join(" "),
				fields: {
					firstName: row.firstName,
					lastName: row.lastName,
					email: row.email,
					phone: row.phone,
					title: row.title,
					linkedinUrl: row.linkedinUrl,
					twitterUrl: row.twitterUrl,
					githubUrl: row.githubUrl,
					companyId: row.company?.name ?? null,
					ownerId: row.owner?.name ?? null,
				},
				relationshipCounts: row._count,
			};
		}
		const row = await this.db.company.findUnique({
			where: { id },
			select: {
				name: true,
				domain: true,
				website: true,
				description: true,
				industry: true,
				city: true,
				country: true,
				countryCode: true,
				phone: true,
				email: true,
				linkedinUrl: true,
				ownerId: true,
				owner: { select: { name: true } },
				_count: {
					select: {
						contacts: true,
						deals: true,
						activities: true,
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
		if (!row)
			throw new NotFoundException("A duplicate record no longer exists.");
		return {
			label: row.name,
			fields: {
				name: row.name,
				domain: row.domain,
				website: row.website,
				description: row.description,
				industry: row.industry,
				city: row.city,
				country: row.country,
				countryCode: row.countryCode,
				phone: row.phone,
				email: row.email,
				linkedinUrl: row.linkedinUrl,
				ownerId: row.owner?.name ?? null,
			},
			relationshipCounts: row._count,
		};
	}
	private label(type: Entity, id: string) {
		return this.snapshot(type, id).then((row) => ({
			label:
				type === "CONTACT"
					? `${row.firstName} ${row.lastName ?? ""}`.trim()
					: String(row.name),
			secondary: type === "CONTACT" ? row.email : row.domain,
		}));
	}
	private snapshot(type: Entity, id: string) {
		return this.snapshotTx(this.db, type, id);
	}
	private async snapshotTx(
		tx: Db | Prisma.TransactionClient,
		type: Entity,
		id: string,
	): Promise<any> {
		const row =
			type === "CONTACT"
				? await tx.contact.findUnique({ where: { id } })
				: await tx.company.findUnique({ where: { id } });
		if (!row)
			throw new NotFoundException("A duplicate record no longer exists.");
		return row;
	}
}
