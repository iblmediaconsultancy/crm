import type { Prisma } from "@crm/db";
import {
	type LinkedInBrowserAction,
	type LinkedInBrowserAdapter,
	type LinkedInBrowserOutcome,
	verifyFreshLinkedInIdentity,
} from "@crm/db/linkedin-browser-adapter";

type JsonValue = Prisma.InputJsonValue;

type Attempt = { id: string; attemptNumber: number };

type ConnectionLease = {
	id: string;
	contactId: string;
	routeId: string;
	profileUrl: string;
	profileIdentifier: string;
};

type MessageLease = {
	id: string;
	conversationId: string;
	messageId: string | null;
	action: "MESSAGE";
	status: string;
	attemptCount: number;
};

export type PreparedConnectionExecution = {
	attempt: Attempt;
	job: ConnectionLease & {
		displayName?: string | null;
		actionPayload?: unknown;
	};
};

export type PreparedMessageExecution = {
	attempt: Attempt;
	action: LinkedInBrowserAction;
};

export type LocalLinkedInExecutorCore = {
	claimNextConnectionRequestJob(
		workerId: string,
		accountKey?: string,
	): Promise<ConnectionLease | null>;
	beginConnectionRequestAttempt(
		jobId: string,
		workerId: string,
	): Promise<PreparedConnectionExecution | { blockedReason: string }>;
	recordConnectionRequestAttempt(input: {
		jobId: string;
		workerId: string;
		attemptNumber: number;
		status: "SUCCEEDED" | "FAILED" | "AMBIGUOUS" | "BLOCKED";
		externalRequestKey?: string | null;
		verifiedProfileUrl?: string | null;
		verifiedProfileIdentifier?: string | null;
		browserProof?: JsonValue;
		details?: JsonValue;
		errorCode?: string | null;
	}): Promise<unknown>;
	claimNextJob(workerId: string): Promise<MessageLease | null>;
	prepareMessageExecution(
		jobId: string,
		workerId: string,
	): Promise<PreparedMessageExecution | { blockedReason: string }>;
	recordAttempt(input: {
		jobId: string;
		workerId: string;
		attemptNumber: number;
		status: "SUCCEEDED" | "FAILED" | "AMBIGUOUS" | "BLOCKED";
		externalMessageKey?: string | null;
		externalConversationKey?: string | null;
		verifiedProfileUrl?: string | null;
		verifiedProfileIdentifier?: string | null;
		browserProof?: JsonValue;
		details?: JsonValue;
		errorCode?: string | null;
	}): Promise<unknown>;
};

export type LocalLinkedInExecutorResult =
	| { status: "IDLE" }
	| { status: "COMPLETED"; jobId: string; action: string }
	| { status: "FAILED"; jobId: string; action: string; reason: string }
	| { status: "BLOCKED"; jobId: string; action: string; reason: string }
	| { status: "NEEDS_IHSAN"; jobId: string; action: string; reason: string };

function isDeterministicReviewError(errorCode: string): boolean {
	return new Set([
		"PROFILE_URL_MISMATCH",
		"PROFILE_IDENTIFIER_MISMATCH",
		"DISPLAY_NAME_MISMATCH",
		"CONVERSATION_ID_MISMATCH",
		"EXTERNAL_CONVERSATION_MISMATCH",
		"WRONG_CONVERSATION",
	]).has(errorCode);
}

function noteFromPayload(payload: unknown): string | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return null;
	const note = (payload as { note?: unknown }).note;
	return typeof note === "string" && note.trim() ? note.trim() : null;
}

function proofDetails(
	outcome: Extract<LinkedInBrowserOutcome, { status: "CONFIRMED" }>,
): JsonValue {
	return {
		browserProof: outcome.browserProof,
		observedIdentity: outcome.observedIdentity,
		observedAt: outcome.observedAt.toISOString(),
	} as Prisma.InputJsonObject;
}

function confirmedOutcomeValid(
	action: LinkedInBrowserAction,
	outcome: Extract<LinkedInBrowserOutcome, { status: "CONFIRMED" }>,
): { allowed: true } | { allowed: false; reason: string } {
	const identity = verifyFreshLinkedInIdentity(
		action.target,
		outcome.observedIdentity,
	);
	if (!identity.allowed) return identity;
	if (
		action.action === "CONNECTION_REQUEST" &&
		outcome.observedIdentity.relationshipState !== "PENDING"
	)
		return { allowed: false, reason: "CONNECTION_RESULT_UNCLEAR" };
	if (
		action.action === "MESSAGE" &&
		outcome.observedIdentity.relationshipState !== "CONNECTED"
	)
		return { allowed: false, reason: "MESSAGE_RESULT_UNCLEAR" };
	return { allowed: true };
}

export class LocalLinkedInExecutor {
	constructor(
		private readonly core: LocalLinkedInExecutorCore,
		private readonly browser: LinkedInBrowserAdapter,
		private readonly workerId: string,
		private readonly accountKey = "default",
	) {}

	async runOnce(): Promise<LocalLinkedInExecutorResult> {
		const connection = await this.core.claimNextConnectionRequestJob(
			this.workerId,
			this.accountKey,
		);
		if (connection) return this.runConnection(connection.id);
		const message = await this.core.claimNextJob(this.workerId);
		if (message) return this.runMessage(message.id);
		return { status: "IDLE" };
	}

	private async runConnection(
		jobId: string,
	): Promise<LocalLinkedInExecutorResult> {
		let prepared: Awaited<
			ReturnType<LocalLinkedInExecutorCore["beginConnectionRequestAttempt"]>
		>;
		try {
			prepared = await this.core.beginConnectionRequestAttempt(
				jobId,
				this.workerId,
			);
		} catch (error) {
			return {
				status: "NEEDS_IHSAN",
				jobId,
				action: "CONNECTION_REQUEST",
				reason: error instanceof Error ? error.message : "PREPARATION_FAILED",
			};
		}
		if ("blockedReason" in prepared)
			return {
				status: "BLOCKED",
				jobId,
				action: "CONNECTION_REQUEST",
				reason: prepared.blockedReason,
			};
		const action: LinkedInBrowserAction = {
			jobId,
			action: "CONNECTION_REQUEST",
			browserSessionKey: this.workerId,
			note: noteFromPayload(prepared.job.actionPayload),
			target: {
				contactId: prepared.job.contactId,
				routeId: prepared.job.routeId,
				profileUrl: prepared.job.profileUrl,
				profileIdentifier: prepared.job.profileIdentifier,
				displayName: prepared.job.displayName,
			},
		};
		return this.executeConnection(action, prepared.attempt);
	}

	private async runMessage(
		jobId: string,
	): Promise<LocalLinkedInExecutorResult> {
		let prepared: Awaited<
			ReturnType<LocalLinkedInExecutorCore["prepareMessageExecution"]>
		>;
		try {
			prepared = await this.core.prepareMessageExecution(jobId, this.workerId);
		} catch (error) {
			return {
				status: "NEEDS_IHSAN",
				jobId,
				action: "MESSAGE",
				reason: error instanceof Error ? error.message : "PREPARATION_FAILED",
			};
		}
		if ("blockedReason" in prepared)
			return {
				status: "BLOCKED",
				jobId,
				action: "MESSAGE",
				reason: prepared.blockedReason,
			};
		return this.executeMessage(prepared.action, prepared.attempt);
	}

	private async executeConnection(
		action: LinkedInBrowserAction,
		attempt: Attempt,
	): Promise<LocalLinkedInExecutorResult> {
		const outcome = await this.browser.execute(action);
		if (outcome.status === "CONFIRMED") {
			const validation = confirmedOutcomeValid(action, outcome);
			if (!validation.allowed)
				return this.recordConnectionReview(action, attempt, validation.reason);
			try {
				await this.core.recordConnectionRequestAttempt({
					jobId: action.jobId,
					workerId: this.workerId,
					attemptNumber: attempt.attemptNumber,
					status: "SUCCEEDED",
					externalRequestKey: outcome.externalRequestKey,
					verifiedProfileUrl: outcome.observedIdentity.profileUrl,
					verifiedProfileIdentifier: outcome.observedIdentity.profileIdentifier,
					browserProof: outcome.browserProof as JsonValue,
					details: proofDetails(outcome),
				});
				return {
					status: "COMPLETED",
					jobId: action.jobId,
					action: action.action,
				};
			} catch {
				return {
					status: "NEEDS_IHSAN",
					jobId: action.jobId,
					action: action.action,
					reason: "RESULT_PERSISTENCE_UNCLEAR",
				};
			}
		}
		if (outcome.status === "AMBIGUOUS") {
			await this.core.recordConnectionRequestAttempt({
				jobId: action.jobId,
				workerId: this.workerId,
				attemptNumber: attempt.attemptNumber,
				status: "AMBIGUOUS",
				errorCode: outcome.errorCode,
				browserProof: outcome.browserProof as JsonValue,
				details: {
					browserProof: outcome.browserProof,
					observedIdentity: outcome.observedIdentity,
					observedAt: outcome.observedAt.toISOString(),
				} as Prisma.InputJsonObject,
			});
			return {
				status: "NEEDS_IHSAN",
				jobId: action.jobId,
				action: action.action,
				reason: outcome.errorCode,
			};
		}
		if (isDeterministicReviewError(outcome.errorCode)) {
			await this.core.recordConnectionRequestAttempt({
				jobId: action.jobId,
				workerId: this.workerId,
				attemptNumber: attempt.attemptNumber,
				status: "AMBIGUOUS",
				errorCode: outcome.errorCode,
			});
			return {
				status: "NEEDS_IHSAN",
				jobId: action.jobId,
				action: action.action,
				reason: outcome.errorCode,
			};
		}
		await this.core.recordConnectionRequestAttempt({
			jobId: action.jobId,
			workerId: this.workerId,
			attemptNumber: attempt.attemptNumber,
			status: "FAILED",
			errorCode: outcome.errorCode,
		});
		return {
			status: "FAILED",
			jobId: action.jobId,
			action: action.action,
			reason: outcome.errorCode,
		};
	}

	private async executeMessage(
		action: LinkedInBrowserAction,
		attempt: Attempt,
	): Promise<LocalLinkedInExecutorResult> {
		const outcome = await this.browser.execute(action);
		if (outcome.status === "CONFIRMED") {
			const validation = confirmedOutcomeValid(action, outcome);
			if (!validation.allowed)
				return this.recordMessageReview(action, attempt, validation.reason);
			try {
				await this.core.recordAttempt({
					jobId: action.jobId,
					workerId: this.workerId,
					attemptNumber: attempt.attemptNumber,
					status: "SUCCEEDED",
					externalMessageKey: outcome.externalMessageKey,
					externalConversationKey:
						outcome.externalConversationKey ??
						action.target.externalConversationKey,
					verifiedProfileUrl: outcome.observedIdentity.profileUrl,
					verifiedProfileIdentifier: outcome.observedIdentity.profileIdentifier,
					browserProof: outcome.browserProof as JsonValue,
					details: proofDetails(outcome),
				});
				return {
					status: "COMPLETED",
					jobId: action.jobId,
					action: action.action,
				};
			} catch {
				return {
					status: "NEEDS_IHSAN",
					jobId: action.jobId,
					action: action.action,
					reason: "RESULT_PERSISTENCE_UNCLEAR",
				};
			}
		}
		if (outcome.status === "AMBIGUOUS") {
			await this.core.recordAttempt({
				jobId: action.jobId,
				workerId: this.workerId,
				attemptNumber: attempt.attemptNumber,
				status: "AMBIGUOUS",
				errorCode: outcome.errorCode,
				browserProof: outcome.browserProof as JsonValue,
				details: {
					browserProof: outcome.browserProof,
					observedIdentity: outcome.observedIdentity,
					observedAt: outcome.observedAt.toISOString(),
				} as Prisma.InputJsonObject,
			});
			return {
				status: "NEEDS_IHSAN",
				jobId: action.jobId,
				action: action.action,
				reason: outcome.errorCode,
			};
		}
		if (isDeterministicReviewError(outcome.errorCode)) {
			await this.core.recordAttempt({
				jobId: action.jobId,
				workerId: this.workerId,
				attemptNumber: attempt.attemptNumber,
				status: "AMBIGUOUS",
				errorCode: outcome.errorCode,
			});
			return {
				status: "NEEDS_IHSAN",
				jobId: action.jobId,
				action: action.action,
				reason: outcome.errorCode,
			};
		}
		await this.core.recordAttempt({
			jobId: action.jobId,
			workerId: this.workerId,
			attemptNumber: attempt.attemptNumber,
			status: "FAILED",
			errorCode: outcome.errorCode,
		});
		return {
			status: "FAILED",
			jobId: action.jobId,
			action: action.action,
			reason: outcome.errorCode,
		};
	}

	private async recordConnectionReview(
		action: LinkedInBrowserAction,
		attempt: Attempt,
		reason: string,
	): Promise<LocalLinkedInExecutorResult> {
		await this.core.recordConnectionRequestAttempt({
			jobId: action.jobId,
			workerId: this.workerId,
			attemptNumber: attempt.attemptNumber,
			status: "AMBIGUOUS",
			errorCode: reason,
		});
		return {
			status: "NEEDS_IHSAN",
			jobId: action.jobId,
			action: action.action,
			reason,
		};
	}

	private async recordMessageReview(
		action: LinkedInBrowserAction,
		attempt: Attempt,
		reason: string,
	): Promise<LocalLinkedInExecutorResult> {
		await this.core.recordAttempt({
			jobId: action.jobId,
			workerId: this.workerId,
			attemptNumber: attempt.attemptNumber,
			status: "AMBIGUOUS",
			errorCode: reason,
		});
		return {
			status: "NEEDS_IHSAN",
			jobId: action.jobId,
			action: action.action,
			reason,
		};
	}
}
