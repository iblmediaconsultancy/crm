import {
	ActivityType,
	type Db,
	EmailDirection,
	type MailboxSyncModel as MailboxSync,
	type Prisma,
	Prisma as PrismaNamespace,
	RecordSource,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import {
	assessInboundSecurity,
	SECURITY_REVIEW_REASON,
} from "./inbound-security";
import {
	MailboxMatchService,
	type MatchContext,
} from "./mailbox-match.service";
import { snippetOf } from "./message-text";
import type { Participant } from "./participants";

export type IngestionOrigin = "miab" | "legacy";

export type IncomingMessage = {
	rfcMessageId: string;
	rootId: string;
	subject: string | null;
	from: Participant;
	recipients: { email: string; name: string | null; kind: "to" | "cc" }[];
	body: string;
	sentAt: Date;
	attachmentCount?: number;
};

@Injectable()
export class ThreadWriterService {
	private readonly logger = new Logger(ThreadWriterService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly match: MailboxMatchService,
		private readonly stamp: ActivityStampService,
	) {}

	async context(): Promise<MatchContext> {
		const [internal, suppressedDomains, suppressedEmails] = await Promise.all([
			this.match.internalIdentity(),
			this.match.suppressedDomains(),
			this.match.suppressedEmails(),
		]);

		return {
			ourAddresses: internal.addresses,
			ourDomains: internal.domains,
			suppressedDomains,
			suppressedEmails,
		};
	}

	async store(
		row: MailboxSync,
		options: {
			mailbox: string;
			origin: IngestionOrigin;
			exactContactId?: string;
			projectActivity?: boolean;
		},
		parsed: IncomingMessage,
		context?: MatchContext,
	): Promise<boolean> {
		const existing = await this.db.emailMessage.findUnique({
			where: {
				mailboxId_rfcMessageId: {
					mailboxId: row.mailboxId,
					rfcMessageId: parsed.rfcMessageId,
				},
			},
			select: {
				threadId: true,
				thread: {
					select: {
						rootMessageId: true,
						companyId: true,
						contactId: true,
						leadId: true,
						activity: { select: { id: true } },
					},
				},
			},
		});
		if (existing?.thread.activity) return false;

		const repair = existing !== null;
		const participants = [parsed.from, ...parsed.recipients];
		const outbound = parsed.from.email === options.mailbox;

		let thread = existing
			? {
					id: existing.threadId,
					rootMessageId: existing.thread.rootMessageId,
					companyId: existing.thread.companyId,
					contactId: existing.thread.contactId,
					leadId: existing.thread.leadId,
				}
			: await this.db.emailThread.findUnique({
					where: {
						mailboxId_rootMessageId: {
							mailboxId: row.mailboxId,
							rootMessageId: parsed.rootId,
						},
					},
					select: {
						id: true,
						rootMessageId: true,
						companyId: true,
						contactId: true,
						leadId: true,
					},
				});
		if (!thread && !outbound) {
			thread = await this.findThreadByReplyIdentifier(
				row.mailboxId,
				parsed.rootId,
			);
		}

		let companyId = thread?.companyId ?? null;
		let contactId = thread?.contactId ?? null;
		let knownContact = Boolean(contactId);

		if (!thread && options.exactContactId) {
			contactId = options.exactContactId;
			knownContact = true;
		} else if (!thread) {
			if (!context) throw new Error("Mailbox match context is required.");
			const repliedTo =
				outbound ||
				(await this.hasOutboundInThread(
					parsed.rootId,
					options.mailbox,
					row.mailboxId,
				));

			const match = await this.match.resolve(
				{
					participants,
					allowCreate: row.autoCreate && repliedTo,
					source: RecordSource.EMAIL,
					ownerId: row.userId,
				},
				context,
			);

			companyId = match.companyId;
			contactId = match.contactId;
			knownContact = Boolean(contactId);

			if (!companyId && !contactId) {
				const securityReview = assessInboundSecurity({
					subject: parsed.subject,
					body: parsed.body,
					fromEmail: parsed.from.email,
					fromName: parsed.from.name,
					trustedDomains: context.ourDomains,
					attachmentCount: parsed.attachmentCount,
					knownContact,
					existingConversationReply: false,
					threadIdentifiersMatch: false,
				});
				if (!securityReview.flagged) return false;
			}
		}

		if (!thread && contactId && !outbound) {
			const related = await this.findConversationThread(
				row.mailboxId,
				contactId,
				parsed.subject,
			);
			if (related) {
				thread = related;
				companyId = related.companyId;
				contactId = related.contactId;
			}
		}

		const securityReview = !outbound
			? assessInboundSecurity({
					subject: parsed.subject,
					body: parsed.body,
					fromEmail: parsed.from.email,
					fromName: parsed.from.name,
					trustedDomains:
						context?.ourDomains ??
						new Set(
							[options.mailbox.split("@").at(-1)?.toLowerCase()].filter(
								(value): value is string => Boolean(value),
							),
						),
					attachmentCount: parsed.attachmentCount,
					knownContact,
					existingConversationReply: Boolean(thread),
					threadIdentifiersMatch: Boolean(
						thread && !existing && thread.rootMessageId === parsed.rootId,
					),
				})
			: { flagged: false, signals: [] };

		let occurredAt: Date;

		try {
			occurredAt = await this.db.$transaction(async (tx) => {
				const lead = contactId
					? await tx.lead.findFirst({
							where: {
								contactId,
								stage: { notIn: ["WON", "LOST"] },
							},
							orderBy: { updatedAt: "desc" },
							select: { id: true },
						})
					: null;
				let leadId = thread?.leadId ?? lead?.id ?? null;
				if (securityReview.flagged && !leadId && !contactId) {
					const existingContact = await tx.contact.findFirst({
						where: {
							email: { equals: parsed.from.email, mode: "insensitive" },
						},
						select: { id: true },
					});
					contactId =
						existingContact?.id ??
						(
							await tx.contact.create({
								data: {
									firstName: parsed.from.name?.trim() || parsed.from.email,
									lastName: null,
									email: parsed.from.email,
									source: RecordSource.EMAIL,
									ownerId: row.userId,
								},
								select: { id: true },
							})
						).id;
				}
				if (securityReview.flagged && !leadId) {
					const securityLead = await tx.lead.create({
						data: {
							name: parsed.from.name?.trim() || parsed.from.email,
							stage: "REPLIED",
							stageChangedAt: parsed.sentAt,
							contactId,
							companyId,
							ownerUserId: row.userId,
							createdByUserId: row.userId,
							source: RecordSource.EMAIL,
							originChannel: "EMAIL",
							nextActionAt: new Date(),
							nextActionTitle: "Ihsan security review required",
							attentionState: "NEEDS_IHSAN",
							blocker: SECURITY_REVIEW_REASON,
							handoffReason: SECURITY_REVIEW_REASON,
							handoffSummary:
								"Inbound email requires manual security review before Atlas continues.",
							handoffRecommendedAction:
								"Review the message manually. Do not follow links, open attachments, or provide sensitive information.",
							handoffAt: new Date(),
							needsReview: true,
						},
						select: { id: true },
					});
					leadId = securityLead.id;
				}
				const record = existing
					? { id: existing.threadId }
					: thread
						? { id: thread.id }
						: await tx.emailThread.upsert({
								where: {
									mailboxId_rootMessageId: {
										mailboxId: row.mailboxId,
										rootMessageId: parsed.rootId,
									},
								},
								create: {
									mailboxId: row.mailboxId,
									rootMessageId: parsed.rootId,
									subject: parsed.subject,
									companyId,
									contactId,
									leadId,
									firstMessageAt: parsed.sentAt,
									lastMessageAt: parsed.sentAt,
									messageCount: 0,
								},
								update: {},
								select: { id: true },
							});
				if (leadId) {
					await tx.emailThread.updateMany({
						where: { id: record.id, leadId: null },
						data: { leadId },
					});
				}

				if (!repair) {
					await tx.emailMessage.create({
						data: {
							threadId: record.id,
							mailboxId: row.mailboxId,
							rfcMessageId: parsed.rfcMessageId,
							syncedByUserId: row.userId,
							direction: outbound
								? EmailDirection.OUTBOUND
								: EmailDirection.INBOUND,
							fromEmail: parsed.from.email,
							fromName: parsed.from.name,
							recipients: parsed.recipients,
							subject: parsed.subject,
							snippet: snippetOf(parsed.body),
							body: parsed.body || null,
							sentAt: parsed.sentAt,
						},
					});
				}

				if (!outbound && contactId) {
					const plans = await tx.followUpPlan.findMany({
						where: { contactId, status: { in: ["ACTIVE", "PAUSED"] } },
						select: { id: true },
					});
					const planIds = plans.map((plan) => plan.id);
					if (planIds.length) {
						const steps = await tx.followUpStep.findMany({
							where: { planId: { in: planIds }, draftId: { not: null } },
							select: { draftId: true },
						});
						const draftIds = [
							...new Set(
								steps.flatMap((step) => (step.draftId ? [step.draftId] : [])),
							),
						];
						await tx.followUpPlan.updateMany({
							where: { id: { in: planIds } },
							data: {
								status: "CANCELLED",
								cancellationReason: "Inbound reply received",
							},
						});
						await tx.followUpStep.updateMany({
							where: {
								planId: { in: planIds },
								status: { in: ["PENDING", "LEASED", "QUEUED"] },
							},
							data: {
								status: "CANCELLED",
								leaseOwner: null,
								leasedUntil: null,
							},
						});
						if (draftIds.length) {
							await tx.draft.updateMany({
								where: { id: { in: draftIds }, status: "QUEUED" },
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
									lastErrorCode: "INBOUND_REPLY",
								},
							});
						}
					}
				}
				if (securityReview.flagged && leadId) {
					await tx.lead.update({
						where: { id: leadId },
						data: {
							attentionState: "NEEDS_IHSAN",
							blocker: SECURITY_REVIEW_REASON,
							handoffReason: SECURITY_REVIEW_REASON,
							handoffSummary:
								"Inbound email requires manual security review before Atlas continues.",
							handoffRecommendedAction:
								"Review the message manually. Do not follow links, open attachments, or provide sensitive information.",
							handoffAt: new Date(),
							needsReview: true,
						},
					});
				}
				if (!outbound && leadId) {
					const current = await tx.lead.findUnique({
						where: { id: leadId },
						select: { stage: true },
					});
					if (current && !["WON", "LOST"].includes(current.stage)) {
						await tx.lead.update({
							where: { id: leadId },
							data: {
								stage: "REPLIED",
								stageChangedAt: parsed.sentAt,
								lastRepliedAt: parsed.sentAt,
								nextActionAt: securityReview.flagged
									? new Date()
									: new Date(parsed.sentAt.getTime() + 24 * 60 * 60 * 1000),
								nextActionTitle: securityReview.flagged
									? "Ihsan security review required"
									: "Review reply and decide the next step",
							},
						});
						if (current.stage !== "REPLIED") {
							await tx.leadStageHistory.create({
								data: {
									leadId,
									fromStage: current.stage,
									toStage: "REPLIED",
									reason: "Inbound reply received",
									actorUserId: "atlas-operator",
								},
							});
						}
					}
				}
				const repliedDelivery = await tx.outboundDelivery.findFirst({
					where: {
						status: { in: ["SENT", "DELIVERED"] },
						draft: { recipientRoute: { contactId } },
					},
					orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
					select: { id: true },
				});
				if (repliedDelivery) {
					await tx.outboundDelivery.update({
						where: { id: repliedDelivery.id },
						data: { status: "REPLIED" },
					});
				}
				const stats = await tx.emailMessage.aggregate({
					where: { threadId: record.id },
					_count: { _all: true },
					_min: { sentAt: true },
					_max: { sentAt: true },
				});

				const firstMessageAt = stats._min.sentAt ?? parsed.sentAt;
				const lastMessageAt = stats._max.sentAt ?? parsed.sentAt;

				await tx.emailThread.update({
					where: { id: record.id },
					data: {
						messageCount: stats._count._all,
						firstMessageAt,
						lastMessageAt,
						...(parsed.sentAt <= firstMessageAt
							? { subject: parsed.subject }
							: {}),
					},
				});

				if (options.projectActivity === false) return lastMessageAt;
				return this.project(tx, record.id, row.userId, {
					subject: parsed.subject ?? "(no subject)",
					snippet: snippetOf(parsed.body),
					lastMessageAt,
					companyId,
					contactId,
					leadId,
					origin: options.origin,
				});
			});
		} catch (error) {
			if (await this.storedElsewhere(error, parsed.rfcMessageId, row.mailboxId))
				return false;
			throw error;
		}

		if (securityReview.flagged) {
			this.logger.warn({
				message: "Inbound email routed to security review",
				mailboxId: row.mailboxId,
				contactId,
				reason: SECURITY_REVIEW_REASON,
				signals: securityReview.signals,
			});
		}

		await this.touch({ companyId, contactId }, occurredAt, parsed.rfcMessageId);

		return !repair;
	}

	private async storedElsewhere(
		error: unknown,
		rfcMessageId: string,
		mailboxId: string,
	): Promise<boolean> {
		const duplicate =
			error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
			error.code === "P2002";
		if (!duplicate) return false;

		const winner = await this.db.emailMessage.findFirst({
			where: { rfcMessageId, mailboxId, thread: { activity: { isNot: null } } },
			select: { id: true },
		});

		return winner !== null;
	}

	private async touch(
		target: { companyId: string | null; contactId: string | null },
		at: Date,
		rfcMessageId: string,
	): Promise<void> {
		try {
			await this.stamp.touch(target, at);
		} catch (error) {
			this.logger.error(
				{
					message: "An email was stored but its activity stamps were not moved",
					rfcMessageId,
					...target,
				},
				error instanceof Error ? error.stack : String(error),
			);
		}
	}

	private async hasOutboundInThread(
		rootMessageId: string,
		mailbox: string,
		mailboxId: string,
	): Promise<boolean> {
		const found = await this.db.emailMessage.findFirst({
			where: {
				thread: { rootMessageId, mailboxId },
				fromEmail: mailbox,
			},
			select: { id: true },
		});

		return found !== null;
	}

	private async findConversationThread(
		mailboxId: string,
		contactId: string,
		subject: string | null,
	) {
		const normalizedSubject = conversationSubject(subject);
		if (!normalizedSubject) return null;

		const candidates = await this.db.emailThread.findMany({
			where: {
				mailboxId,
				contactId,
				messages: { some: { direction: EmailDirection.OUTBOUND } },
			},
			orderBy: { lastMessageAt: "desc" },
			take: 20,
			select: {
				id: true,
				rootMessageId: true,
				companyId: true,
				contactId: true,
				leadId: true,
				subject: true,
			},
		});

		return (
			candidates.find(
				(candidate) =>
					conversationSubject(candidate.subject) === normalizedSubject,
			) ?? null
		);
	}

	private async findThreadByReplyIdentifier(
		mailboxId: string,
		replyIdentifier: string,
	) {
		const normalized = normalizeMessageId(replyIdentifier);
		const withoutBrackets = normalized.replace(/^<|>$/g, "");
		const delivery = await this.db.outboundDelivery.findFirst({
			where: {
				providerMessageId: { in: [normalized, withoutBrackets] },
				draft: { mailboxId },
			},
			orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
			select: {
				draft: {
					select: {
						leadId: true,
						recipientRoute: { select: { contactId: true } },
					},
				},
			},
		});
		if (!delivery) return null;

		const leadId = delivery.draft.leadId;
		const contactId = delivery.draft.recipientRoute?.contactId ?? null;
		if (!leadId && !contactId) return null;

		return this.db.emailThread.findFirst({
			where: {
				mailboxId,
				messages: { some: { direction: EmailDirection.OUTBOUND } },
				OR: [
					...(leadId ? [{ leadId }] : []),
					...(contactId ? [{ contactId }] : []),
				],
			},
			orderBy: { lastMessageAt: "desc" },
			select: {
				id: true,
				rootMessageId: true,
				companyId: true,
				contactId: true,
				leadId: true,
			},
		});
	}

	private async project(
		tx: Prisma.TransactionClient,
		emailThreadId: string,
		userId: string,
		summary: {
			subject: string;
			snippet: string | null;
			lastMessageAt: Date;
			companyId: string | null;
			contactId: string | null;
			leadId: string | null;
			origin: IngestionOrigin;
		},
	): Promise<Date> {
		const activity = await tx.activity.upsert({
			where: { emailThreadId },
			create: {
				type: ActivityType.EMAIL,
				subject: summary.subject,
				body: summary.snippet,
				occurredAt: summary.lastMessageAt,
				companyId: summary.companyId,
				contactId: summary.contactId,
				leadId: summary.leadId,
				createdById: userId,
				emailThreadId,
				meta: { synced: true, source: summary.origin },
			},
			update: {
				body: summary.snippet,
				occurredAt: summary.lastMessageAt,
			},
			select: { createdAt: true },
		});

		return activity.createdAt;
	}
}

function conversationSubject(value: string | null): string | null {
	const normalized = value
		?.trim()
		.toLowerCase()
		.replace(/^(?:(?:re|fw|fwd):\s*)+/i, "")
		.trim();
	return normalized || null;
}

function normalizeMessageId(value: string): string {
	return value.trim().toLowerCase();
}
