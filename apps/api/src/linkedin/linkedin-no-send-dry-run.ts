import {
	type LinkedInBrowserTarget,
	type LinkedInRelationshipState,
	linkedInConversationIdentityMatches,
	linkedInDisplayNamesMatch,
	linkedInProfileRecordsMatch,
} from "@crm/db/linkedin-browser-adapter";
import type { LinkedInMessageComposerResolution } from "./message-composer-resolver";

export type LinkedInNoSendTarget = Pick<
	LinkedInBrowserTarget,
	| "contactId"
	| "routeId"
	| "conversationId"
	| "profileUrl"
	| "profileIdentifier"
	| "stableMemberIdentifier"
	| "displayName"
	| "externalConversationKey"
> &
	Pick<LinkedInBrowserTarget, "expectNoExistingConversation">;

export type LinkedInNoSendProfileObservation = {
	authenticated: boolean;
	challenge: string | null;
	profileUrl: string | null;
	profileIdentifier: string | null;
	stableMemberIdentifier?: string | null;
	displayName?: string | null;
	relationshipState?: LinkedInRelationshipState;
	pendingInvitationState?: "NONE" | "SENT" | "RECEIVED" | "UNKNOWN";
	externalConversationKey?: string | null;
	conversationParticipantIdentifier?: string | null;
};

export type LinkedInNoSendComposerObservation = {
	authenticated: boolean;
	challenge: string | null;
	resolution: LinkedInMessageComposerResolution;
};

export interface LinkedInNoSendBrowser {
	navigateToRecipient(profileUrl: string): Promise<void>;
	inspectRecipient(): Promise<LinkedInNoSendProfileObservation>;
	navigateToComposer(url: string): Promise<void>;
	inspectComposer(
		expectedRecipientIdentifier: string,
		expectedExternalConversationKey: string | null,
	): Promise<LinkedInNoSendComposerObservation>;
	close(): Promise<void>;
}

export type LinkedInNoSendDryRunResult =
	| {
			status: "READY";
			stage: "COMPOSER_READY";
			relationshipState: "CONNECTED";
			pendingInvitationState: "NONE" | "SENT" | "RECEIVED" | "UNKNOWN";
			profileUrl: string;
			profileIdentifier: string;
			contactId: string;
			routeId: string;
			conversationId: string | null;
			displayName: string | null;
			recipientIdentifier: string;
			conversationParticipantIdentifier: string;
			externalConversationKey: string | null;
			externalMessageKey: string | null;
			preparedMessage: string | null;
	  }
	| {
			status: "BLOCKED";
			stage:
				| "TARGET_VALIDATION"
				| "PROFILE_NAVIGATION"
				| "PROFILE_VERIFICATION"
				| "RELATIONSHIP_VERIFICATION"
				| "COMPOSER_NAVIGATION"
				| "COMPOSER_VERIFICATION";
			reason: string;
	  };

export function linkedinNoSendComposerUrl(
	target: LinkedInNoSendTarget,
): string | null {
	if (target.externalConversationKey) {
		let key = target.externalConversationKey.trim();
		try {
			const parsed = new URL(key);
			if (
				parsed.protocol !== "https:" ||
				!new Set(["linkedin.com", "www.linkedin.com"]).has(
					parsed.hostname.toLocaleLowerCase(),
				)
			)
				return null;
			key =
				parsed.pathname.match(/^\/messaging\/thread\/([^/?#]+)\/?$/i)?.[1] ??
				"";
		} catch {}
		try {
			key = decodeURIComponent(key);
		} catch {
			return null;
		}
		if (!/^[A-Za-z0-9._~:-]+={0,2}$/.test(key)) return null;
		return `https://www.linkedin.com/messaging/thread/${key}/`;
	}
	const recipient = target.stableMemberIdentifier?.trim() ?? "";
	if (!/^ACo[A-Za-z0-9_-]+$/.test(recipient)) return null;
	const url = new URL("https://www.linkedin.com/messaging/compose/");
	url.searchParams.set("recipient", recipient);
	url.searchParams.set("profileUrn", `urn:li:fsd_profile:${recipient}`);
	return url.href;
}

export function prepareLinkedInMessageForNoSend(
	body: string | null | undefined,
): string | null {
	const prepared = body?.trim() ?? "";
	return prepared.length > 0 && prepared.length <= 3000 ? prepared : null;
}

function targetProfileIsSafe(target: LinkedInNoSendTarget): boolean {
	try {
		const url = new URL(target.profileUrl);
		return (
			url.protocol === "https:" &&
			new Set(["linkedin.com", "www.linkedin.com"]).has(
				url.hostname.toLocaleLowerCase(),
			) &&
			/^\/in\/[^/]+\/?$/i.test(url.pathname) &&
			Boolean(target.contactId.trim()) &&
			Boolean(target.routeId.trim()) &&
			Boolean(target.profileIdentifier.trim())
		);
	} catch {
		return false;
	}
}

export async function runLinkedInNoSendDryRun(input: {
	target: LinkedInNoSendTarget;
	body?: string | null;
	browser: LinkedInNoSendBrowser;
}): Promise<LinkedInNoSendDryRunResult> {
	const { target, browser } = input;
	if (!targetProfileIsSafe(target))
		return {
			status: "BLOCKED",
			stage: "TARGET_VALIDATION",
			reason: "CRM_LINKEDIN_TARGET_INVALID",
		};
	if (
		Boolean(target.conversationId) !==
			Boolean(target.externalConversationKey) ||
		(target.expectNoExistingConversation && target.conversationId)
	)
		return {
			status: "BLOCKED",
			stage: "TARGET_VALIDATION",
			reason: "CRM_CONVERSATION_IDENTITY_INCOMPLETE",
		};
	const composerUrl = linkedinNoSendComposerUrl(target);
	if (!composerUrl)
		return {
			status: "BLOCKED",
			stage: "TARGET_VALIDATION",
			reason: "CRM_COMPOSER_IDENTITY_UNAVAILABLE",
		};

	try {
		try {
			await browser.navigateToRecipient(target.profileUrl);
		} catch (error) {
			return {
				status: "BLOCKED",
				stage: "PROFILE_NAVIGATION",
				reason:
					error instanceof Error ? error.message : "PROFILE_NAVIGATION_FAILED",
			};
		}

		let profile: LinkedInNoSendProfileObservation;
		try {
			profile = await browser.inspectRecipient();
		} catch (error) {
			return {
				status: "BLOCKED",
				stage: "PROFILE_VERIFICATION",
				reason:
					error instanceof Error ? error.message : "PROFILE_INSPECTION_FAILED",
			};
		}
		if (profile.challenge)
			return {
				status: "BLOCKED",
				stage: "PROFILE_VERIFICATION",
				reason: "LINKEDIN_SECURITY_CHALLENGE",
			};
		if (!profile.authenticated)
			return {
				status: "BLOCKED",
				stage: "PROFILE_VERIFICATION",
				reason: "LINKEDIN_LOGIN_REQUIRED",
			};
		if (
			!linkedInProfileRecordsMatch(
				{
					profileUrl: target.profileUrl,
					profileIdentifier: target.profileIdentifier,
					stableMemberIdentifier: target.stableMemberIdentifier,
				},
				{
					profileUrl: profile.profileUrl,
					profileIdentifier: profile.profileIdentifier,
					stableMemberIdentifier: profile.stableMemberIdentifier,
				},
			) ||
			(target.displayName &&
				(!profile.displayName ||
					!linkedInDisplayNamesMatch(target.displayName, profile.displayName)))
		)
			return {
				status: "BLOCKED",
				stage: "PROFILE_VERIFICATION",
				reason: "LINKEDIN_PROFILE_IDENTITY_MISMATCH",
			};
		if (profile.relationshipState !== "CONNECTED")
			return {
				status: "BLOCKED",
				stage: "RELATIONSHIP_VERIFICATION",
				reason: `LINKEDIN_RELATIONSHIP_${profile.relationshipState ?? "UNKNOWN"}`,
			};

		try {
			await browser.navigateToComposer(composerUrl);
		} catch (error) {
			return {
				status: "BLOCKED",
				stage: "COMPOSER_NAVIGATION",
				reason:
					error instanceof Error ? error.message : "COMPOSER_NAVIGATION_FAILED",
			};
		}
		let composer: LinkedInNoSendComposerObservation;
		try {
			composer = await browser.inspectComposer(
				target.stableMemberIdentifier?.trim() ?? "",
				target.externalConversationKey ?? null,
			);
		} catch (error) {
			return {
				status: "BLOCKED",
				stage: "COMPOSER_VERIFICATION",
				reason:
					error instanceof Error ? error.message : "COMPOSER_INSPECTION_FAILED",
			};
		}
		if (composer.challenge)
			return {
				status: "BLOCKED",
				stage: "COMPOSER_VERIFICATION",
				reason: "LINKEDIN_SECURITY_CHALLENGE",
			};
		if (!composer.authenticated)
			return {
				status: "BLOCKED",
				stage: "COMPOSER_VERIFICATION",
				reason: "LINKEDIN_LOGIN_REQUIRED",
			};
		if (
			composer.resolution.status !== "FOUND" ||
			composer.resolution.recipientIdentifier !==
				target.stableMemberIdentifier?.trim() ||
			(target.externalConversationKey &&
				!composer.resolution.externalConversationKey) ||
			(target.expectNoExistingConversation &&
				(composer.resolution.externalMessageKey ||
					composer.resolution.externalConversationKey)) ||
			!linkedInConversationIdentityMatches(
				{
					profileUrl: target.profileUrl,
					profileIdentifier: target.profileIdentifier,
					externalConversationKey: target.externalConversationKey,
				},
				{
					externalConversationKey: composer.resolution.externalConversationKey,
					conversationParticipantIdentifier:
						composer.resolution.recipientIdentifier,
				},
			)
		)
			return {
				status: "BLOCKED",
				stage: "COMPOSER_VERIFICATION",
				reason: `LINKEDIN_COMPOSER_${composer.resolution.status}`,
			};

		return {
			status: "READY",
			stage: "COMPOSER_READY",
			relationshipState: "CONNECTED",
			pendingInvitationState: profile.pendingInvitationState ?? "UNKNOWN",
			profileUrl: profile.profileUrl ?? target.profileUrl,
			profileIdentifier: profile.profileIdentifier ?? target.profileIdentifier,
			contactId: target.contactId,
			routeId: target.routeId,
			conversationId: target.conversationId ?? null,
			displayName: profile.displayName ?? null,
			recipientIdentifier: composer.resolution.recipientIdentifier,
			conversationParticipantIdentifier:
				composer.resolution.recipientIdentifier,
			externalConversationKey: composer.resolution.externalConversationKey,
			externalMessageKey: composer.resolution.externalMessageKey,
			preparedMessage: prepareLinkedInMessageForNoSend(input.body),
		};
	} finally {
		await browser.close();
	}
}
