import {
	ActivityType,
	type Db,
	EmailDirection,
	type LeadStage,
	type MailboxSyncModel as MailboxSync,
	type Prisma,
	Prisma as PrismaNamespace,
	RecordSource,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import { businessDaysAfter } from "../providers/working-hours";
import {
	classifyInboundIntent,
	type InboundIntentDecision,
	isHumanReplyIntent,
} from "./inbound-intent";
import {
	assessInboundSecurity,
	type InboundAttachmentMetadata,
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
	attachments?: readonly InboundAttachmentMetadata[];
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
				id: true,
				threadId: true,
				thread: {
					select: {
						rootMessageId: true,
						companyId: true,
						contactId: true,
						leadId: true,
						id: true,
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
					attachments: parsed.attachments,
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
					attachments: parsed.attachments,
					knownContact,
					existingConversationReply: Boolean(thread),
					threadIdentifiersMatch: Boolean(
						thread && !existing && thread.rootMessageId === parsed.rootId,
					),
				})
			: { flagged: false, signals: [] };
		const inboundIntent = !outbound
			? classifyInboundIntent({
					subject: parsed.subject,
					body: parsed.body,
					fromName: parsed.from.name,
					securityReview,
				})
			: null;

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
							select: { id: true, version: true },
						})
					: null;
				let leadId = thread?.leadId ?? lead?.id ?? null;
				let autoReplyNextActionAt: Date | null = null;
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
							inboundIntent: inboundIntent?.intent,
							inboundIntentReason: inboundIntent?.reason,
							inboundSecuritySignals: securityReview.flagged
								? securityReview.signals
								: undefined,
						},
					});
				}
				if (!outbound && existing && inboundIntent) {
					await tx.emailMessage.update({
						where: { id: existing.id },
						data: {
							inboundIntent: inboundIntent.intent,
							inboundIntentReason: inboundIntent.reason,
							inboundSecuritySignals: securityReview.flagged
								? securityReview.signals
								: PrismaNamespace.JsonNull,
						},
					});
				}

				if (
					!outbound &&
					contactId &&
					inboundIntent &&
					inboundIntent.intent !== "AUTO_REPLY"
				) {
					const plans = await tx.followUpPlan.findMany({
						where: {
							contactId,
							channel: "EMAIL",
							status: { in: ["ACTIVE", "PAUSED"] },
						},
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
				if (!outbound && contactId && inboundIntent?.intent === "AUTO_REPLY") {
					autoReplyNextActionAt = await this.restoreAutoReplyPlansTx(
						tx,
						contactId,
					);
				}
				if (!outbound && contactId && inboundIntent) {
					const engagementStatus =
						inboundIntent.intent === "AUTO_REPLY"
							? "WAITING_ON_PROSPECT"
							: inboundIntent.intent === "SECURITY_REVIEW"
								? "NEEDS_IHSAN"
								: "ACTIVE_HUMAN_CONVERSATION";
					await tx.channelEngagementState.upsert({
						where: {
							contactId_channel: { contactId, channel: "EMAIL" },
						},
						create: {
							contactId,
							channel: "EMAIL",
							status: engagementStatus,
							lastInboundAt: parsed.sentAt,
							reason: inboundIntent.reason,
						},
						update: {
							status: engagementStatus,
							lastInboundAt: parsed.sentAt,
							reason: inboundIntent.reason,
						},
					});
				}
				if (!outbound && leadId && inboundIntent) {
					await this.applyInboundLeadTx(tx, {
						leadId,
						contactId,
						parsed,
						decision: inboundIntent,
						autoReplyNextActionAt,
					});
				}
				const repliedDelivery = await tx.outboundDelivery.findFirst({
					where: {
						status: { in: ["SENT", "DELIVERED", "REPLIED"] },
						draft: { recipientRoute: { contactId } },
					},
					orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
					select: { id: true },
				});
				if (!outbound && repliedDelivery && inboundIntent) {
					await tx.outboundDelivery.update({
						where: { id: repliedDelivery.id },
						data: {
							status: "REPLIED",
							replyIntent: inboundIntent?.intent,
							replyIntentAt: inboundIntent ? parsed.sentAt : undefined,
						},
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

	async reconcileStoredInbound(
		messageId: string,
		options: { attachments?: readonly InboundAttachmentMetadata[] } = {},
	): Promise<boolean> {
		const message = await this.db.emailMessage.findUnique({
			where: { id: messageId },
			select: {
				id: true,
				rfcMessageId: true,
				mailboxId: true,
				direction: true,
				fromEmail: true,
				fromName: true,
				subject: true,
				body: true,
				sentAt: true,
				thread: {
					select: {
						rootMessageId: true,
						companyId: true,
						contactId: true,
						leadId: true,
					},
				},
			},
		});
		if (!message || message.direction !== EmailDirection.INBOUND) return false;

		const context = await this.context();
		const securityReview = assessInboundSecurity({
			subject: message.subject,
			body: message.body ?? "",
			fromEmail: message.fromEmail,
			fromName: message.fromName,
			trustedDomains: context.ourDomains,
			attachmentCount: options.attachments?.length,
			attachments: options.attachments,
			knownContact: Boolean(message.thread.contactId),
			existingConversationReply: true,
			threadIdentifiersMatch: true,
		});
		const decision = classifyInboundIntent({
			subject: message.subject,
			body: message.body ?? "",
			fromName: message.fromName,
			securityReview,
		});

		await this.db.$transaction(async (tx) => {
			await tx.emailMessage.update({
				where: { id: message.id },
				data: {
					inboundIntent: decision.intent,
					inboundIntentReason: decision.reason,
					inboundSecuritySignals: securityReview.flagged
						? securityReview.signals
						: PrismaNamespace.JsonNull,
				},
			});
			let autoReplyNextActionAt: Date | null = null;
			if (message.thread.contactId) {
				if (decision.intent === "AUTO_REPLY") {
					autoReplyNextActionAt = await this.restoreAutoReplyPlansTx(
						tx,
						message.thread.contactId,
					);
				} else {
					await this.cancelForInboundTx(tx, message.thread.contactId);
				}
			}
			if (message.thread.leadId) {
				await this.applyInboundLeadTx(tx, {
					leadId: message.thread.leadId,
					contactId: message.thread.contactId,
					parsed: {
						rfcMessageId: message.rfcMessageId,
						rootId: message.thread.rootMessageId,
						subject: message.subject,
						from: { email: message.fromEmail, name: message.fromName },
						recipients: [],
						body: message.body ?? "",
						sentAt: message.sentAt,
						attachments: options.attachments,
					},
					decision,
					autoReplyNextActionAt,
				});
			}
			const repliedDelivery = await tx.outboundDelivery.findFirst({
				where: {
					status: { in: ["SENT", "DELIVERED", "REPLIED"] },
					draft: {
						recipientRoute: { contactId: message.thread.contactId },
					},
				},
				orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
				select: { id: true },
			});
			if (repliedDelivery) {
				await tx.outboundDelivery.update({
					where: { id: repliedDelivery.id },
					data: {
						status: "REPLIED",
						replyIntent: decision.intent,
						replyIntentAt: message.sentAt,
					},
				});
			}
		});
		return true;
	}

	private async applyInboundLeadTx(
		tx: Prisma.TransactionClient,
		input: {
			leadId: string;
			contactId: string | null;
			parsed: IncomingMessage;
			decision: InboundIntentDecision;
			autoReplyNextActionAt: Date | null;
		},
	): Promise<void> {
		const current = await tx.lead.findUnique({
			where: { id: input.leadId },
			select: {
				stage: true,
				status: true,
				attentionState: true,
				lastRepliedAt: true,
				version: true,
			},
		});
		if (!current || ["WON", "LOST"].includes(current.stage)) return;

		const { decision, parsed } = input;
		if (decision.intent === "SECURITY_REVIEW") {
			const updatedLead = await tx.lead.updateMany({
				where: { id: input.leadId, version: current.version },
				data: {
					stage: "REPLIED",
					stageChangedAt: parsed.sentAt,
					attentionState: "NEEDS_IHSAN",
					blocker: SECURITY_REVIEW_REASON,
					handoffReason: SECURITY_REVIEW_REASON,
					handoffSummary:
						"Inbound email requires manual security review before Atlas continues.",
					handoffRecommendedAction:
						"Review the message manually. Do not follow links, open attachments, or provide sensitive information.",
					handoffAt: new Date(),
					needsReview: true,
					nextActionAt: new Date(),
					nextActionTitle: "Ihsan security review required",
				},
			});
			if (updatedLead.count === 1)
				await this.recordStageTransitionTx(
					tx,
					input.leadId,
					current.stage,
					"REPLIED",
					"Inbound security review required",
				);
		} else if (decision.intent === "HUMAN_NEGATIVE") {
			await this.suppressNegativeTx(tx, input);
			const updatedLead = await tx.lead.updateMany({
				where: { id: input.leadId, version: current.version },
				data: {
					status: "DISQUALIFIED",
					stage: "LOST",
					stageChangedAt: parsed.sentAt,
					lastRepliedAt: parsed.sentAt,
					outcome: "NOT_A_FIT",
					outcomeNote: decision.organizationWide
						? "Explicit agency-wide negative response."
						: "Explicit negative response.",
					blocker: "NOT_INTERESTED",
					attentionState: "SUPPRESSED",
					nextActionAt: null,
					nextActionTitle: null,
					parkedUntil: null,
					disqualifiedAt: parsed.sentAt,
					handoffReason: null,
					handoffSummary: null,
					handoffRecommendedAction: null,
					handoffAt: null,
					needsReview: false,
				},
			});
			if (updatedLead.count === 1)
				await this.recordStageTransitionTx(
					tx,
					input.leadId,
					current.stage,
					"LOST",
					"Explicit negative inbound response",
				);
		} else if (decision.intent === "AUTO_REPLY") {
			const nextActionAt =
				input.autoReplyNextActionAt ?? businessDaysAfter(parsed.sentAt, 3);
			const nextStage =
				current.stage === "REPLIED" ? "CONTACTED" : current.stage;
			const updatedLead = await tx.lead.updateMany({
				where: { id: input.leadId, version: current.version },
				data: {
					stage: nextStage,
					stageChangedAt:
						nextStage === current.stage ? undefined : parsed.sentAt,
					lastRepliedAt:
						current.lastRepliedAt?.getTime() === parsed.sentAt.getTime()
							? null
							: undefined,
					attentionState: "NONE",
					blocker: null,
					handoffReason: null,
					handoffSummary: null,
					handoffRecommendedAction: null,
					handoffAt: null,
					needsReview: false,
					nextActionAt,
					nextActionTitle: "Follow up after automatic reply delay",
					parkedUntil: null,
				},
			});
			if (updatedLead.count === 1)
				await this.recordStageTransitionTx(
					tx,
					input.leadId,
					current.stage,
					nextStage,
					"Automatic reply received; waiting for a human response",
				);
		} else if (decision.intent === "HUMAN_NEUTRAL" && decision.parked) {
			const parkedUntil = businessDaysAfter(parsed.sentAt, 10);
			const updatedLead = await tx.lead.updateMany({
				where: { id: input.leadId, version: current.version },
				data: {
					stage: "REPLIED",
					stageChangedAt: parsed.sentAt,
					lastRepliedAt: parsed.sentAt,
					attentionState: "PARKED",
					nextActionAt: parkedUntil,
					nextActionTitle: "Revisit deferred reply",
					parkedUntil,
					needsReview: false,
				},
			});
			if (updatedLead.count === 1)
				await this.recordStageTransitionTx(
					tx,
					input.leadId,
					current.stage,
					"REPLIED",
					"Inbound reply deferred future contact",
				);
		} else if (isHumanReplyIntent(decision.intent)) {
			const handoff = decision.intent === "REFERRAL_OR_ROUTING";
			const updatedLead = await tx.lead.updateMany({
				where: { id: input.leadId, version: current.version },
				data: {
					stage: "REPLIED",
					stageChangedAt: parsed.sentAt,
					lastRepliedAt: parsed.sentAt,
					attentionState: handoff ? "NEEDS_IHSAN" : "NONE",
					nextActionAt: new Date(),
					nextActionTitle: handoff
						? "Ihsan review of inbound reply"
						: "Review reply and decide the next step",
					blocker: handoff ? decision.intent : null,
					handoffReason: handoff ? decision.intent : null,
					handoffSummary: handoff
						? "Inbound reply requires manual relationship handling."
						: null,
					handoffRecommendedAction: handoff
						? "Review the reply and decide the next relationship step."
						: null,
					handoffAt: handoff ? new Date() : null,
					needsReview: handoff,
				},
			});
			if (updatedLead.count === 1)
				await this.recordStageTransitionTx(
					tx,
					input.leadId,
					current.stage,
					"REPLIED",
					"Human inbound reply received",
				);
		}
		await tx.domainAuditEvent.upsert({
			where: {
				action_requestId: {
					action: "INBOUND_INTENT_CLASSIFIED",
					requestId: `inbound-intent:${parsed.rfcMessageId}`,
				},
			},
			create: {
				actorUserId: "atlas-operator",
				action: "INBOUND_INTENT_CLASSIFIED",
				entityType: "OUTREACH",
				entityId: null,
				outcome: decision.intent,
				requestId: `inbound-intent:${parsed.rfcMessageId}`,
				metadata: {
					organizationWide: decision.organizationWide,
					reason: decision.reason,
				},
			},
			update: {
				outcome: decision.intent,
				metadata: {
					organizationWide: decision.organizationWide,
					reason: decision.reason,
				},
			},
		});
	}

	private async suppressNegativeTx(
		tx: Prisma.TransactionClient,
		input: {
			leadId: string;
			contactId: string | null;
			parsed: IncomingMessage;
			decision: InboundIntentDecision;
		},
	): Promise<void> {
		if (!input.contactId) return;
		const email = input.parsed.from.email.trim().toLowerCase();
		const route = await tx.contactRoute.findFirst({
			where: {
				contactId: input.contactId,
				type: "EMAIL",
				normalizedValue: email,
			},
			select: { id: true },
		});
		const reason = input.decision.organizationWide
			? "Explicit agency-wide negative inbound reply"
			: "Explicit negative inbound reply";
		await tx.suppressedContact.upsert({
			where: { email },
			create: { email, reason },
			update: { reason },
		});
		if (route) {
			await tx.contactRouteConsent.upsert({
				where: { routeId: route.id },
				create: {
					routeId: route.id,
					contactId: input.contactId,
					status: "DO_NOT_CONTACT",
					reason,
					source: "INBOUND_EMAIL",
				},
				update: {
					status: "DO_NOT_CONTACT",
					reason,
					source: "INBOUND_EMAIL",
					changedByUserId: null,
					changedAt: new Date(),
					version: { increment: 1 },
				},
			});
		}
		await tx.contact.update({
			where: { id: input.contactId },
			data: {
				outreachState: "SUPPRESSED",
				outreachStateReason: reason,
				outreachStateChangedAt: new Date(),
			},
		});
		const domain = email.split("@").at(-1);
		if (input.decision.organizationWide && domain) {
			await tx.suppressedDomain.upsert({
				where: { domain },
				create: { domain, reason },
				update: { reason },
			});
			await tx.domainAuditEvent.upsert({
				where: {
					action_requestId: {
						action: "OUTREACH_ORGANIZATION_SUPPRESSED",
						requestId: `organization-suppression:${domain}`,
					},
				},
				create: {
					actorUserId: "atlas-operator",
					action: "OUTREACH_ORGANIZATION_SUPPRESSED",
					entityType: "COMPANY",
					entityId: null,
					outcome: "SUPPRESSED",
					requestId: `organization-suppression:${domain}`,
					metadata: { domain, reason, leadId: input.leadId },
				},
				update: {
					outcome: "SUPPRESSED",
					metadata: { domain, reason, leadId: input.leadId },
				},
			});
		}
		await tx.domainAuditEvent.upsert({
			where: {
				action_requestId: {
					action: "OUTREACH_ROUTE_SUPPRESSED",
					requestId: `route-suppression:${input.parsed.rfcMessageId}`,
				},
			},
			create: {
				actorUserId: "atlas-operator",
				action: "OUTREACH_ROUTE_SUPPRESSED",
				entityType: "CONTACT",
				entityId: input.contactId,
				outcome: "SUPPRESSED",
				requestId: `route-suppression:${input.parsed.rfcMessageId}`,
				metadata: { email, reason, routeId: route?.id ?? null },
			},
			update: {
				outcome: "SUPPRESSED",
				metadata: { email, reason, routeId: route?.id ?? null },
			},
		});
	}

	private async recordStageTransitionTx(
		tx: Prisma.TransactionClient,
		leadId: string,
		fromStage: LeadStage,
		toStage: LeadStage,
		reason: string,
	): Promise<void> {
		if (fromStage === toStage) return;
		await tx.leadStageHistory.create({
			data: {
				leadId,
				fromStage,
				toStage,
				reason,
				actorUserId: "atlas-operator",
			},
		});
	}

	private async cancelForInboundTx(
		tx: Prisma.TransactionClient,
		contactId: string,
	): Promise<void> {
		const plans = await tx.followUpPlan.findMany({
			where: {
				contactId,
				channel: "EMAIL",
				status: { in: ["ACTIVE", "PAUSED"] },
			},
			select: { id: true },
		});
		const planIds = plans.map((plan) => plan.id);
		if (!planIds.length) return;
		const steps = await tx.followUpStep.findMany({
			where: { planId: { in: planIds }, draftId: { not: null } },
			select: { draftId: true },
		});
		const draftIds = [
			...new Set(steps.flatMap((step) => (step.draftId ? [step.draftId] : []))),
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
			data: { status: "CANCELLED", leaseOwner: null, leasedUntil: null },
		});
		if (!draftIds.length) return;
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

	private async restoreAutoReplyPlansTx(
		tx: Prisma.TransactionClient,
		contactId: string,
	): Promise<Date | null> {
		const plans = await tx.followUpPlan.findMany({
			where: {
				contactId,
				channel: "EMAIL",
				status: "CANCELLED",
				cancellationReason: "Inbound reply received",
			},
			select: { id: true },
		});
		const planIds = plans.map((plan) => plan.id);
		if (!planIds.length) return null;
		await tx.followUpPlan.updateMany({
			where: { id: { in: planIds } },
			data: { status: "ACTIVE", cancellationReason: null },
		});
		await tx.followUpStep.updateMany({
			where: { planId: { in: planIds }, status: "CANCELLED" },
			data: { status: "PENDING", leaseOwner: null, leasedUntil: null },
		});
		const next = await tx.followUpStep.findFirst({
			where: { planId: { in: planIds }, status: "PENDING" },
			orderBy: { dueAt: "asc" },
			select: { dueAt: true },
		});
		return next?.dueAt ?? null;
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
		.replace(
			/^(?:(?:re|fw|fwd|aw|automatic reply|auto reply|out of office):\s*)+/i,
			"",
		)
		.trim();
	return normalized || null;
}

function normalizeMessageId(value: string): string {
	return value.trim().toLowerCase();
}
