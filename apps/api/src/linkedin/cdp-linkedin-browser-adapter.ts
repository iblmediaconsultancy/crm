import {
	firstMessageBrowserStateAllowsSend,
	type LinkedInBrowserAction,
	type LinkedInBrowserAdapter,
	type LinkedInBrowserIdentityEvidence,
	type LinkedInBrowserOutcome,
	type LinkedInRelationshipState,
	linkedInConversationIdentityMatches,
	resolveLinkedInComposeConversationEvidence,
	verifyLinkedInActionState,
} from "@crm/db/linkedin-browser-adapter";
import {
	type LinkedInConnectionRequestModal,
	type LinkedInConnectionRequestModalAction,
	resolveLinkedInConnectionRequestModalControl,
} from "./connection-request-modal-resolver";
import {
	type LinkedInMessageComposerResolution,
	type LinkedInMessageComposerSnapshot,
	type LinkedInMessageComposerSurface,
	linkedInMessageComposerControlReady,
	resolveLinkedInMessageComposer,
	summarizeLinkedInMessageComposerSnapshot,
	waitForStableLinkedInMessageComposer,
} from "./message-composer-resolver";
import {
	type LinkedInRelationshipControl,
	resolveLinkedInRelationshipControl,
} from "./relationship-control-resolver";

type PageElement = {
	closest(selector: string): PageElement | null;
	tagName: string;
	textContent: string | null;
	innerText: string;
	querySelectorAll(selector: string): PageElement[];
	getAttribute(name: string): string | null;
	getBoundingClientRect(): { width: number; height: number };
	isConnected: boolean;
};

type PageDocument = {
	body?: { innerText?: string };
	title: string;
	createRange(): { selectNodeContents(element: PageElement): void };
	getSelection(): {
		removeAllRanges(): void;
		addRange(range: { selectNodeContents(element: PageElement): void }): void;
	} | null;
	execCommand(command: string, showUI: boolean, value?: string): boolean;
	querySelectorAll(selector: string): PageElement[];
	querySelector(selector: string): PageElement | null;
};

declare const document: PageDocument;
declare const location: { href: string };
declare function getComputedStyle(element: PageElement): {
	display: string;
	visibility: string;
	opacity: string;
};

type CdpTarget = {
	type?: string;
	url?: string;
	webSocketDebuggerUrl?: string;
};

type ConnectionRequestModalInspection = {
	status: "NONE" | "AMBIGUOUS" | "FOUND" | "CHALLENGE";
	challenge: string | null;
};

type CdpReply = {
	id?: number;
	result?: { result?: { value?: unknown } };
	error?: { message?: string };
};

type PageObservation = LinkedInBrowserIdentityEvidence & {
	href: string;
	title: string;
	challenge: string | null;
	authenticated: boolean;
	externalMessageKey: string | null;
	profileHeadingCandidates: Array<{
		text: string;
		visible: boolean;
		excluded: boolean;
	}>;
	controls: LinkedInRelationshipControl[];
};

type MessageComposerInspection = LinkedInMessageComposerResolution;

function collectLinkedInMessageComposerSnapshot(): LinkedInMessageComposerSnapshot {
	const state = globalThis as unknown as {
		atlasComposerNodes?: {
			identities: WeakMap<PageElement, number>;
			next: number;
		};
	};
	if (!state.atlasComposerNodes)
		state.atlasComposerNodes = { identities: new WeakMap(), next: 1 };
	const nodes = state.atlasComposerNodes;
	const nodeIdentity = (element: PageElement): number => {
		const existing = nodes.identities.get(element);
		if (existing !== undefined) return existing;
		const identity = nodes.next++;
		nodes.identities.set(element, identity);
		return identity;
	};
	const isVisible = (element: PageElement): boolean => {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return Boolean(
			element.isConnected &&
				rect.width > 0 &&
				rect.height > 0 &&
				style.display !== "none" &&
				style.visibility !== "hidden" &&
				style.opacity !== "0" &&
				element.getAttribute("aria-hidden") !== "true",
		);
	};
	const normalize = (value: string | null): string =>
		(value || "").trim().replace(/\s+/g, " ");
	const currentUrl = location.href;
	const url = new URL(currentUrl);
	const composeRecipient = (() => {
		if (!/^\/messaging\/compose\/?$/i.test(url.pathname)) return null;
		const recipient = url.searchParams.get("recipient")?.trim() ?? "";
		const profileUrn = url.searchParams.get("profileUrn")?.trim() ?? "";
		const profileMember = profileUrn.split(":").at(-1)?.trim() ?? "";
		return /^ACo[A-Za-z0-9_-]+$/.test(recipient) && profileMember === recipient
			? recipient
			: null;
	})();
	const threadMatch = url.pathname.match(/^\/messaging\/thread\/([^/?#]+)/i);
	const threadKey = threadMatch?.[1] ?? null;
	const surfaceElements = Array.from(
		document.querySelectorAll(
			".msg-compose-container, .msg-thread, [role=dialog], .msg-overlay-conversation-bubble, .msg-s-message-list-container",
		),
	).filter((element) => {
		if (!isVisible(element)) return false;
		const classes = element.getAttribute("class") || "";
		if (classes.includes("msg-compose-container")) return true;
		return !element.closest(".msg-compose-container");
	});
	const surfaces = surfaceElements.map((surface, index) => {
		const classes = surface.getAttribute("class") || "";
		const kind: LinkedInMessageComposerSurface["kind"] = classes.includes(
			"msg-compose-container",
		)
			? /^\/in\//i.test(url.pathname)
				? "PROFILE_COMPOSE"
				: "COMPOSE_OVERLAY"
			: classes.includes("msg-thread") ||
					classes.includes("msg-s-message-list-container")
				? "THREAD"
				: "DIALOG";
		const attributes = Array.from(
			surface.querySelectorAll(
				"[data-member-urn], [data-profile-urn], [data-recipient], [data-urn]",
			),
		)
			.map((element) =>
				["data-member-urn", "data-profile-urn", "data-recipient", "data-urn"]
					.map((name) => element.getAttribute(name))
					.find((value): value is string => Boolean(value)),
			)
			.filter((value): value is string => Boolean(value));
		const participantIdentifier =
			composeRecipient ||
			attributes.find((value) => /^ACo[A-Za-z0-9_-]+$/.test(value)) ||
			null;
		const recipientCount =
			kind === "THREAD"
				? 1
				: Array.from(
						surface.querySelectorAll(
							".msg-connections-typeahead__added-recipients .artdeco-pill__text",
						),
					).filter(isVisible).length;
		const editors = Array.from(
			surface.querySelectorAll(
				"textarea, [contenteditable=true], [role=textbox]",
			),
		).map((element, elementIndex) => ({
			index: elementIndex,
			nodeIdentity: nodeIdentity(element),
			tagName: element.tagName,
			role: element.getAttribute("role"),
			ariaLabel: element.getAttribute("aria-label"),
			name: element.getAttribute("name"),
			placeholder: element.getAttribute("placeholder"),
			text: normalize(element.textContent),
			contentEditable: element.getAttribute("contenteditable") === "true",
			visible: isVisible(element),
			connected: element.isConnected,
			disabled:
				element.getAttribute("disabled") !== null ||
				element.getAttribute("aria-disabled") === "true",
		}));
		const sendControls = Array.from(
			surface.querySelectorAll("button, [role=button]"),
		).map((element, elementIndex) => ({
			index: elementIndex,
			tagName: element.tagName,
			role: element.getAttribute("role"),
			ariaLabel: element.getAttribute("aria-label"),
			name: element.getAttribute("name"),
			placeholder: element.getAttribute("placeholder"),
			text: normalize(element.textContent),
			contentEditable: false,
			visible: isVisible(element),
			connected: element.isConnected,
			disabled:
				element.getAttribute("disabled") !== null ||
				element.getAttribute("aria-disabled") === "true",
		}));
		const sendControlsOnly = sendControls.filter((control) => {
			const label = normalize(control.ariaLabel).toLocaleLowerCase();
			const text = control.text.toLocaleLowerCase();
			return (text === "send" || label === "send") && !label.includes("option");
		});
		const externalMessageKey =
			Array.from(
				surface.querySelectorAll("[data-message-urn], [data-message-id]"),
			)
				.map(
					(element) =>
						element.getAttribute("data-message-urn") ||
						element.getAttribute("data-message-id"),
				)
				.find((value): value is string => Boolean(value)) || null;
		return {
			index,
			kind,
			recipientIdentifier: participantIdentifier,
			externalConversationKey: threadKey,
			externalMessageKey,
			recipientCount,
			visible: isVisible(surface),
			connected: surface.isConnected,
			editors,
			sendControls: sendControlsOnly,
		};
	});
	return { url: currentUrl, surfaces };
}

export type LinkedInRelationshipDetection = {
	relationshipState: LinkedInRelationshipState;
	pendingInvitationState: "NONE" | "SENT" | "RECEIVED" | "UNKNOWN";
};

export function detectLinkedInRelationshipState(input: {
	profileIdentifier: string | null;
	displayName: string | null;
	controls: LinkedInRelationshipControl[];
}): LinkedInRelationshipDetection {
	const connect = resolveLinkedInRelationshipControl({
		...input,
		action: "CONNECT",
	});
	if (connect.status === "AMBIGUOUS")
		return {
			relationshipState: "AMBIGUOUS",
			pendingInvitationState: "UNKNOWN",
		};
	if (connect.status === "FOUND")
		return { relationshipState: "CONNECT", pendingInvitationState: "UNKNOWN" };
	const pending = resolveLinkedInRelationshipControl({
		...input,
		action: "PENDING",
	});
	if (pending.status === "AMBIGUOUS")
		return {
			relationshipState: "AMBIGUOUS",
			pendingInvitationState: "UNKNOWN",
		};
	if (pending.status === "FOUND")
		return { relationshipState: "PENDING", pendingInvitationState: "SENT" };
	const message = resolveLinkedInRelationshipControl({
		...input,
		action: "MESSAGE",
	});
	if (message.status === "AMBIGUOUS")
		return {
			relationshipState: "AMBIGUOUS",
			pendingInvitationState: "UNKNOWN",
		};
	if (message.status === "FOUND")
		return { relationshipState: "CONNECTED", pendingInvitationState: "NONE" };
	return { relationshipState: "AMBIGUOUS", pendingInvitationState: "UNKNOWN" };
}

export function resolveLinkedInProfileDisplayName(
	headings: Array<{ text: string; visible: boolean; excluded: boolean }>,
): string | null {
	const candidates = headings
		.filter((heading) => {
			const text = heading.text.trim().replace(/\s+/g, " ");
			return (
				heading.visible &&
				!heading.excluded &&
				Boolean(text) &&
				!/^\d+\s+notifications?(?:\s+total)?$/i.test(text)
			);
		})
		.map((heading) => heading.text.trim().replace(/\s+/g, " "));
	const distinctCandidates = new Map(
		candidates.map((candidate) => [candidate.toLocaleLowerCase(), candidate]),
	);
	return distinctCandidates.size === 1
		? ([...distinctCandidates.values()][0] ?? null)
		: null;
}

function collectLinkedInRelationshipControls(
	includeElements = false,
	resolveDisplayName: typeof resolveLinkedInProfileDisplayName,
) {
	const body = document.body?.innerText || "";
	const href = location.href;
	const title = document.title || "";
	const profileMatch = href.match(
		/https?:\/\/(?:www\.)?linkedin\.com\/in\/([^/?#]+)/i,
	);
	const profileHeadingCandidates = Array.from(
		document.querySelectorAll("h1, h2"),
	)
		.slice(0, 20)
		.map((element) => {
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return {
				text: (element.textContent || "")
					.trim()
					.replace(/\s+/g, " ")
					.slice(0, 160),
				visible: Boolean(
					rect.width > 0 &&
						rect.height > 0 &&
						style.display !== "none" &&
						style.visibility !== "hidden" &&
						style.opacity !== "0",
				),
				excluded: Boolean(
					element.closest("[data-testid=toasts-title], dialog"),
				),
			};
		});
	const displayName = resolveDisplayName(profileHeadingCandidates);
	const profileSection = Array.from(document.querySelectorAll("section")).find(
		(element) => displayName && (element.innerText || "").includes(displayName),
	);
	const elements = profileSection
		? Array.from(profileSection.querySelectorAll("button, a[role=button], a"))
		: [];
	const isVisible = (element: PageElement): boolean => {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return Boolean(
			element.isConnected &&
				rect.width > 0 &&
				rect.height > 0 &&
				style.display !== "none" &&
				style.visibility !== "hidden" &&
				style.opacity !== "0" &&
				element.getAttribute("aria-hidden") !== "true",
		);
	};
	const controls = elements.map((element, elementIndex) => {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return {
			elementIndex,
			tagName: element.tagName,
			role: element.getAttribute("role"),
			text: (element.textContent || "").trim().replace(/\s+/g, " "),
			ariaLabel: element.getAttribute("aria-label"),
			href: element.getAttribute("href"),
			targetProfile: true,
			visible: Boolean(
				element.isConnected &&
					rect.width > 0 &&
					rect.height > 0 &&
					style.display !== "none" &&
					style.visibility !== "hidden" &&
					style.opacity !== "0",
			),
			connected: element.isConnected,
		};
	});
	const profileConversationParticipantIdentifiers = Array.from(
		new Set(
			elements
				.map((element) => element.getAttribute("href"))
				.filter((value): value is string => Boolean(value))
				.map((value) => {
					try {
						const url = new URL(value, href);
						if (!/\/messaging\/compose\//i.test(url.pathname)) return null;
						const recipient = url.searchParams.get("recipient");
						const profileUrn = url.searchParams.get("profileUrn");
						const profileMember = profileUrn?.split(":").at(-1) ?? null;
						return recipient && profileMember === recipient ? recipient : null;
					} catch {
						return null;
					}
				})
				.filter((value): value is string => Boolean(value)),
		),
	);
	const composeSurfaces = Array.from(
		document.querySelectorAll(".msg-compose-container"),
	).filter(isVisible);
	const composeSurface =
		/^https?:\/\/[^/]+\/messaging\/compose\//i.test(href) &&
		composeSurfaces.length === 1
			? composeSurfaces[0]
			: null;
	const composeEvidence = resolveLinkedInComposeConversationEvidence(
		href,
		composeSurface
			? Array.from(composeSurface.querySelectorAll("[data-event-urn]"))
					.map((element) => element.getAttribute("data-event-urn"))
					.filter((value): value is string => Boolean(value))
			: [],
		composeSurface
			? Array.from(
					composeSurface.querySelectorAll(
						".msg-connections-typeahead__added-recipients .artdeco-pill__text",
					),
				).filter(isVisible).length
			: 0,
	);
	const conversationParticipantIdentifiers =
		composeEvidence.status === "AMBIGUOUS"
			? []
			: [
					...profileConversationParticipantIdentifiers,
					...(composeEvidence.status === "RESOLVED"
						? [composeEvidence.participantIdentifier]
						: []),
				].filter((value, index, values) => values.indexOf(value) === index);
	const challenge =
		/captcha|security check|verify your identity|identity verification|unusual activity|unusual login|security checkpoint|suspicious activity|account restricted|rate limit|temporarily unavailable/.exec(
			`${body.toLowerCase()} ${title.toLowerCase()}`,
		)?.[0] || null;
	const authenticated =
		!/(?:\/login|\/checkpoint)\b/i.test(href) &&
		!/sign in to linkedin/.test(body.toLowerCase());
	const conversationMatch = href.match(/\/messaging\/thread\/([^/?#]+)/i);
	const messageKey =
		Array.from(
			document.querySelectorAll(
				".msg-thread, .msg-s-message-list-container, .msg-overlay-conversation-bubble, [role=dialog]",
			),
		)
			.filter(isVisible)
			.flatMap((surface) =>
				Array.from(
					surface.querySelectorAll("[data-message-urn], [data-message-id]"),
				),
			)
			.map(
				(element) =>
					element.getAttribute("data-message-urn") ||
					element.getAttribute("data-message-id"),
			)
			.find((value): value is string => Boolean(value)) || null;
	return {
		resolution: profileMatch ? "RESOLVED" : "AMBIGUOUS",
		profileUrl: profileMatch
			? `https://www.linkedin.com/in/${profileMatch[1]}/`
			: null,
		profileIdentifier: profileMatch?.[1] || null,
		displayName,
		externalConversationKey:
			conversationMatch?.[1] ||
			(composeEvidence.status === "RESOLVED"
				? composeEvidence.externalConversationKey
				: null),
		conversationParticipantIdentifier:
			conversationParticipantIdentifiers.length === 1
				? conversationParticipantIdentifiers[0]
				: null,
		href,
		title,
		challenge,
		authenticated,
		externalMessageKey: messageKey,
		profileHeadingCandidates,
		controls,
		elements: includeElements ? elements : undefined,
	};
}

function collectConnectionRequestModals() {
	function isVisible(element: PageElement): boolean {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return Boolean(
			element.isConnected &&
				rect.width > 0 &&
				rect.height > 0 &&
				style.display !== "none" &&
				style.visibility !== "hidden" &&
				style.opacity !== "0" &&
				element.getAttribute("aria-hidden") !== "true",
		);
	}

	const url = new URL(location.href);
	const rawProfileSlug = url.pathname.match(/^\/in\/([^/?#]+)/i)?.[1] ?? null;
	let profileSlug = rawProfileSlug;
	if (profileSlug) {
		try {
			profileSlug = decodeURIComponent(profileSlug);
		} catch {
			profileSlug = null;
		}
	}
	const inviteSlug = /\/preload\/custom-invite\//i.test(url.pathname)
		? url.searchParams.get("vanityName")
		: null;
	const currentProfileSlug = profileSlug ?? inviteSlug;
	const body = document.body?.innerText || "";
	const challenge =
		/captcha|security check|verify your identity|identity verification|unusual activity|unusual login|security checkpoint|suspicious activity|account restricted|rate limit|temporarily unavailable/.exec(
			`${body.toLowerCase()} ${document.title.toLowerCase()}`,
		)?.[0] || null;
	const elements = Array.from(
		document.querySelectorAll('[role="dialog"][data-test-modal]'),
	);
	const modals: LinkedInConnectionRequestModal[] = elements.map(
		(modal, elementIndex) => {
			const controls = Array.from(
				modal.querySelectorAll("button, a[role=button], [role=button]"),
			).map((control, controlIndex) => ({
				elementIndex: controlIndex,
				tagName: control.tagName,
				role: control.getAttribute("role"),
				text: (control.innerText || control.textContent || "")
					.trim()
					.replace(/\s+/g, " "),
				ariaLabel: control.getAttribute("aria-label"),
				closeControl:
					control.getAttribute("data-test-modal-close-btn") !== null,
				visible: isVisible(control),
				connected: control.isConnected,
				disabled:
					control.getAttribute("disabled") !== null ||
					control.getAttribute("aria-disabled") === "true",
			}));
			return {
				elementIndex,
				role: modal.getAttribute("role"),
				dataTestModal: modal.getAttribute("data-test-modal") !== null,
				labelledBy: modal.getAttribute("aria-labelledby"),
				text: (modal.innerText || "").trim().replace(/\s+/g, " "),
				targetNames: Array.from(modal.querySelectorAll("strong"))
					.map((element) =>
						(element.innerText || element.textContent || "").trim(),
					)
					.filter(Boolean),
				visible: isVisible(modal),
				connected: modal.isConnected,
				controls,
			};
		},
	);
	return { currentProfileSlug, challenge, modals, elements };
}

function targetProfileSlug(profileUrl: string): string | null {
	try {
		const url = new URL(profileUrl);
		if (
			url.protocol !== "https:" ||
			!new Set(["linkedin.com", "www.linkedin.com"]).has(
				url.hostname.toLocaleLowerCase(),
			)
		)
			return null;
		const match = url.pathname.match(/^\/in\/([^/?#]+)\/?$/i);
		return match?.[1] ? decodeURIComponent(match[1]) : null;
	} catch {
		return null;
	}
}

function trustedInviteHref(
	href: string | null,
	profileUrl: string,
): string | null {
	const expectedSlug = targetProfileSlug(profileUrl);
	if (!href || !expectedSlug) return null;
	try {
		const url = new URL(href, "https://www.linkedin.com");
		if (
			url.protocol !== "https:" ||
			!new Set(["linkedin.com", "www.linkedin.com"]).has(
				url.hostname.toLocaleLowerCase(),
			) ||
			!/^\/preload\/custom-invite\/?$/i.test(url.pathname)
		)
			return null;
		const vanityName = url.searchParams.get("vanityName");
		if (
			!vanityName ||
			vanityName.toLocaleLowerCase() !== expectedSlug.toLocaleLowerCase()
		)
			return null;
		return url.href;
	} catch {
		return null;
	}
}

export type LinkedInBrowserHealth = {
	status: "READY" | "UNAVAILABLE" | "UNAUTHENTICATED" | "CHALLENGE";
	detail: string;
	url: string | null;
	title: string | null;
};

class CdpConnection {
	private nextId = 1;
	private readonly pending = new Map<
		number,
		{ resolve: (value: CdpReply) => void; reject: (error: Error) => void }
	>();

	private constructor(private readonly socket: WebSocket) {
		socket.addEventListener("message", (event) => {
			const reply = JSON.parse(String(event.data)) as CdpReply;
			if (!reply.id) return;
			const pending = this.pending.get(reply.id);
			if (!pending) return;
			this.pending.delete(reply.id);
			if (reply.error?.message) pending.reject(new Error(reply.error.message));
			else pending.resolve(reply);
		});
	}

	static async connect(url: string): Promise<CdpConnection> {
		const socket = new WebSocket(url);
		await new Promise<void>((resolve, reject) => {
			const onOpen = () => {
				socket.removeEventListener("error", onError);
				resolve();
			};
			const onError = () => reject(new Error("CDP_WEBSOCKET_UNAVAILABLE"));
			socket.addEventListener("open", onOpen, { once: true });
			socket.addEventListener("error", onError, { once: true });
		});
		return new CdpConnection(socket);
	}

	async send(
		method: string,
		params?: Record<string, unknown>,
	): Promise<CdpReply> {
		const id = this.nextId++;
		const reply = new Promise<CdpReply>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
		});
		this.socket.send(JSON.stringify({ id, method, params }));
		return reply;
	}

	close(): void {
		this.socket.close();
	}
}

class CdpPage {
	private constructor(private readonly connection: CdpConnection) {}

	static async connect(url: string): Promise<CdpPage> {
		const connection = await CdpConnection.connect(url);
		await connection.send("Runtime.enable");
		await connection.send("Page.enable");
		return new CdpPage(connection);
	}

	async evaluate<T>(expression: string): Promise<T> {
		const reply = await this.connection.send("Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		return reply.result?.result?.value as T;
	}

	async navigate(url: string): Promise<void> {
		await this.connection.send("Page.navigate", { url });
	}

	async close(): Promise<void> {
		this.connection.close();
	}

	async observe(): Promise<PageObservation> {
		const collect = collectLinkedInRelationshipControls.toString();
		const resolveDisplayName = resolveLinkedInProfileDisplayName.toString();
		const resolveCompose =
			resolveLinkedInComposeConversationEvidence.toString();
		const observation = await this.evaluate<PageObservation>(
			`(() => { const resolveLinkedInComposeConversationEvidence = ${resolveCompose}; const resolveProfileDisplayName = ${resolveDisplayName}; const collectControls = ${collect}; return collectControls(false, resolveProfileDisplayName); })()`,
		);
		return {
			...observation,
			...detectLinkedInRelationshipState({
				profileIdentifier: observation.profileIdentifier,
				displayName: observation.displayName ?? null,
				controls: observation.controls,
			}),
		};
	}

	async clickRelationshipControl(
		action: "CONNECT" | "MESSAGE",
		observation: PageObservation,
	): Promise<{
		clicked: boolean;
		recipientIdentifier: string | null;
		externalConversationKey: string | null;
	}> {
		const collect = collectLinkedInRelationshipControls.toString();
		const resolveDisplayName = resolveLinkedInProfileDisplayName.toString();
		const resolveCompose =
			resolveLinkedInComposeConversationEvidence.toString();
		const resolve = resolveLinkedInRelationshipControl.toString();
		return this.evaluate<{
			clicked: boolean;
			recipientIdentifier: string | null;
			externalConversationKey: string | null;
		}>(`(() => {
			const resolveLinkedInComposeConversationEvidence = ${resolveCompose};
			const resolveProfileDisplayName = ${resolveDisplayName};
			const collectControls = ${collect};
			const resolveControl = ${resolve};
			const recipientFromHref = (href) => {
				if (!href) return null;
				try {
					const url = new URL(href, "https://www.linkedin.com");
					if (!/^\\/messaging\\/compose\\/?$/i.test(url.pathname)) return null;
					const recipient = url.searchParams.get("recipient")?.trim() || "";
					const profileUrn = url.searchParams.get("profileUrn")?.trim() || "";
					const profileMember = profileUrn.split(":").at(-1)?.trim() || "";
					return /^ACo[A-Za-z0-9_-]+$/.test(recipient) && profileMember === recipient ? recipient : null;
				} catch { return null; }
			};
			const conversationFromHref = (href) => {
				if (!href) return null;
				try {
					const url = new URL(href, "https://www.linkedin.com");
					return url.pathname.match(/^\\/messaging\\/thread\\/([^/?#]+)\\/?$/i)?.[1] || null;
				} catch { return null; }
			};
			const snapshot = collectControls(true, resolveProfileDisplayName);
			const resolution = resolveControl({
				action: ${JSON.stringify(action)},
				profileIdentifier: ${JSON.stringify(observation.profileIdentifier)},
				displayName: ${JSON.stringify(observation.displayName)},
				controls: snapshot.controls,
			});
			if (resolution.status !== "FOUND") return { clicked: false, recipientIdentifier: null, externalConversationKey: null };
			const index = resolution.control.elementIndex;
			const element = snapshot.elements?.[index];
			const control = snapshot.controls[index];
			if (!element || !control || !element.isConnected || !control.connected || !control.visible) return { clicked: false, recipientIdentifier: null, externalConversationKey: null };
			const recipientIdentifier = recipientFromHref(control.href);
			const externalConversationKey = conversationFromHref(control.href);
			element.click();
			return { clicked: true, recipientIdentifier, externalConversationKey };
		})()`);
	}

	async clickConnectionControl(
		observation: PageObservation,
	): Promise<{ clicked: boolean; inviteHref: string | null }> {
		const collect = collectLinkedInRelationshipControls.toString();
		const resolveDisplayName = resolveLinkedInProfileDisplayName.toString();
		const resolveCompose =
			resolveLinkedInComposeConversationEvidence.toString();
		const resolve = resolveLinkedInRelationshipControl.toString();
		return this.evaluate<{
			clicked: boolean;
			inviteHref: string | null;
		}>(`(() => {
			const resolveLinkedInComposeConversationEvidence = ${resolveCompose};
			const resolveProfileDisplayName = ${resolveDisplayName};
			const collectControls = ${collect};
			const resolveControl = ${resolve};
			const snapshot = collectControls(true, resolveProfileDisplayName);
			const resolution = resolveControl({
				action: "CONNECT",
				profileIdentifier: ${JSON.stringify(observation.profileIdentifier)},
				displayName: ${JSON.stringify(observation.displayName)},
				controls: snapshot.controls,
			});
			if (resolution.status !== "FOUND") return { clicked: false, inviteHref: null };
			const index = resolution.control.elementIndex;
			const element = snapshot.elements?.[index];
			const control = snapshot.controls[index];
			if (!element || !control || !element.isConnected || !control.connected || !control.visible) return { clicked: false, inviteHref: null };
			const href = element.getAttribute("href");
			if (!href || href !== control.href) return { clicked: false, inviteHref: null };
			element.click();
			return { clicked: true, inviteHref: href };
		})()`);
	}

	async inspectConnectionRequestModal(
		action: LinkedInConnectionRequestModalAction,
		target: LinkedInBrowserAction["target"],
	): Promise<ConnectionRequestModalInspection> {
		return this.resolveConnectionRequestModalControl(action, target, false);
	}

	async clickConnectionRequestModalControl(
		action: LinkedInConnectionRequestModalAction,
		target: LinkedInBrowserAction["target"],
	): Promise<ConnectionRequestModalInspection> {
		return this.resolveConnectionRequestModalControl(action, target, true);
	}

	private async resolveConnectionRequestModalControl(
		action: LinkedInConnectionRequestModalAction,
		target: LinkedInBrowserAction["target"],
		click: boolean,
	): Promise<ConnectionRequestModalInspection> {
		const expectedProfileSlug = targetProfileSlug(target.profileUrl);
		if (!expectedProfileSlug) return { status: "AMBIGUOUS", challenge: null };
		const collect = collectConnectionRequestModals.toString();
		const resolve = resolveLinkedInConnectionRequestModalControl.toString();
		return this.evaluate<ConnectionRequestModalInspection>(`(() => {
			const collectModals = ${collect};
			const resolveControl = ${resolve};
			const snapshot = collectModals();
			const resolution = resolveControl({
				action: ${JSON.stringify(action)},
				expectedProfileSlug: ${JSON.stringify(expectedProfileSlug)},
				currentProfileSlug: snapshot.currentProfileSlug,
				expectedDisplayName: ${JSON.stringify(target.displayName ?? null)},
				modals: snapshot.modals,
			});
			if (snapshot.challenge) return { status: "CHALLENGE", challenge: snapshot.challenge };
			if (resolution.status !== "FOUND") return { status: resolution.status, challenge: null };
			if (!${click ? "true" : "false"}) return { status: "FOUND", challenge: null };
			const modal = snapshot.elements[resolution.modalIndex];
			const element = modal?.querySelectorAll("button, a[role=button], [role=button]")[resolution.controlIndex];
			const control = snapshot.modals[resolution.modalIndex]?.controls[resolution.controlIndex];
			if (!modal || !element || !control || !modal.isConnected || !element.isConnected) return { status: "NONE", challenge: null };
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			const text = (element.innerText || element.textContent || "").trim().replace(/\\s+/g, " ");
			if (!rect.width || !rect.height || style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || element.getAttribute("aria-hidden") === "true" || element.getAttribute("disabled") !== null || element.getAttribute("aria-disabled") === "true") return { status: "NONE", challenge: null };
			if (text !== control.text || element.getAttribute("aria-label") !== control.ariaLabel) return { status: "AMBIGUOUS", challenge: null };
			element.click();
			return { status: "FOUND", challenge: null };
		})()`);
	}

	async navigateToInvite(
		inviteHref: string,
		profileUrl: string,
	): Promise<boolean> {
		const safeHref = trustedInviteHref(inviteHref, profileUrl);
		if (!safeHref) return false;
		await this.navigate(safeHref);
		return true;
	}

	async isOnInviteRoute(): Promise<boolean> {
		return this.evaluate<boolean>(
			`/\\/preload\\/custom-invite\\//i.test(new URL(location.href).pathname)`,
		);
	}

	async inspectMessageComposer(
		expectedRecipientIdentifier: string | null,
		expectedExternalConversationKey: string | null,
	): Promise<MessageComposerInspection> {
		const collect = collectLinkedInMessageComposerSnapshot.toString();
		const resolve = resolveLinkedInMessageComposer.toString();
		return this.evaluate<MessageComposerInspection>(`(() => {
			const collectSnapshot = ${collect};
			const resolveComposer = ${resolve};
			return resolveComposer(collectSnapshot(), {
				expectedRecipientIdentifier: ${JSON.stringify(expectedRecipientIdentifier)},
				expectedExternalConversationKey: ${JSON.stringify(expectedExternalConversationKey)},
			});
		})()`);
	}

	async inspectMessageComposerDiagnostics() {
		const collect = collectLinkedInMessageComposerSnapshot.toString();
		const summarize = summarizeLinkedInMessageComposerSnapshot.toString();
		return this.evaluate(`(() => {
			const collectSnapshot = ${collect};
			const summarizeSnapshot = ${summarize};
			return summarizeSnapshot(collectSnapshot());
		})()`);
	}

	async fillAndSend(
		body: string,
		expectedRecipientIdentifier: string | null = null,
		expectedExternalConversationKey: string | null = null,
	): Promise<boolean | "AMBIGUOUS"> {
		if (expectedRecipientIdentifier || expectedExternalConversationKey) {
			const collect = collectLinkedInMessageComposerSnapshot.toString();
			const resolve = resolveLinkedInMessageComposer.toString();
			const focusReady = await this.evaluate<boolean>(`(() => {
				const collectSnapshot = ${collect};
				const resolveComposer = ${resolve};
				const isVisible = (element) => {
					const rect = element.getBoundingClientRect();
					const style = getComputedStyle(element);
					return Boolean(element.isConnected && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && element.getAttribute("aria-hidden") !== "true");
				};
				const surfaces = Array.from(document.querySelectorAll(".msg-compose-container, .msg-thread, [role=dialog], .msg-overlay-conversation-bubble, .msg-s-message-list-container")).filter((element) => {
					if (!isVisible(element)) return false;
					const classes = element.getAttribute("class") || "";
					if (classes.includes("msg-compose-container")) return true;
					return !element.closest(".msg-compose-container");
				});
				const resolution = resolveComposer(collectSnapshot(), {
					expectedRecipientIdentifier: ${JSON.stringify(expectedRecipientIdentifier)},
					expectedExternalConversationKey: ${JSON.stringify(expectedExternalConversationKey)},
				});
				if (resolution.status !== "FOUND") return false;
				const surface = surfaces[resolution.surfaceIndex];
				const editors = surface ? Array.from(surface.querySelectorAll("textarea, [contenteditable=true], [role=textbox]")) : [];
				const editor = editors[resolution.editorIndex];
				if (!editor || !editor.isConnected || !isVisible(editor)) return false;
				editor.focus();
				if (editor instanceof HTMLTextAreaElement) {
					editor.select();
				} else {
					const selection = document.getSelection();
					const range = document.createRange();
					range.selectNodeContents(editor);
					selection?.removeAllRanges();
					selection?.addRange(range);
				}
				return true;
			})()`);
			if (!focusReady) return false;
			await this.connection.send("Input.insertText", { text: body });
			let lastStatus: LinkedInMessageComposerResolution["status"] = "NONE";
			for (let attempt = 0; attempt < 20; attempt += 1) {
				const resolution = await this.inspectMessageComposer(
					expectedRecipientIdentifier,
					expectedExternalConversationKey,
				);
				lastStatus = resolution.status;
				if (resolution.status === "FOUND") {
					const sent = await this.evaluate<boolean>(`(() => {
						const value = ${JSON.stringify(body)};
						const collectSnapshot = ${collect};
						const resolveComposer = ${resolve};
						const sendControlReady = ${linkedInMessageComposerControlReady.toString()};
						const isVisible = (element) => {
							const rect = element.getBoundingClientRect();
							const style = getComputedStyle(element);
							return Boolean(element.isConnected && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && element.getAttribute("aria-hidden") !== "true");
						};
						const surfaces = Array.from(document.querySelectorAll(".msg-compose-container, .msg-thread, [role=dialog], .msg-overlay-conversation-bubble, .msg-s-message-list-container")).filter((element) => {
							if (!isVisible(element)) return false;
							const classes = element.getAttribute("class") || "";
							if (classes.includes("msg-compose-container")) return true;
							return !element.closest(".msg-compose-container");
						});
						const resolution = resolveComposer(collectSnapshot(), {
							expectedRecipientIdentifier: ${JSON.stringify(expectedRecipientIdentifier)},
							expectedExternalConversationKey: ${JSON.stringify(expectedExternalConversationKey)},
						});
						if (resolution.status !== "FOUND") return false;
						const surface = surfaces[resolution.surfaceIndex];
						const editors = surface ? Array.from(surface.querySelectorAll("textarea, [contenteditable=true], [role=textbox]")) : [];
						const sends = surface ? Array.from(surface.querySelectorAll("button, [role=button]")) : [];
						const editor = editors[resolution.editorIndex];
						const send = sends[resolution.sendControlIndex];
						const snapshot = collectSnapshot().surfaces.find((candidate) => candidate.index === resolution.surfaceIndex);
						const sendSnapshot = snapshot?.sendControls.find((control) => control.index === resolution.sendControlIndex);
						const text = editor instanceof HTMLTextAreaElement ? editor?.value : editor?.textContent || "";
						const label = send && (((send.textContent || "").trim().toLocaleLowerCase() === "send") || ((send.getAttribute("aria-label") || "").trim().toLocaleLowerCase() === "send"));
						if (!editor || !send || !sendSnapshot || !sendControlReady(sendSnapshot) || !isVisible(editor) || !isVisible(send) || !label || text !== value) return false;
						send.click();
						return true;
					})()`);
					if (sent) return true;
				}
				await new Promise((resolveWait) => setTimeout(resolveWait, 100));
			}
			return lastStatus === "AMBIGUOUS" ? "AMBIGUOUS" : false;
		}
		return this.evaluate<boolean>(`(() => {
			const value = ${JSON.stringify(body)};
			const editor = document.querySelector("textarea, [contenteditable=true]");
			if (!editor) return false;
			(editor as HTMLElement).focus();
			if (editor instanceof HTMLTextAreaElement) {
				const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
				setter?.call(editor, value);
			} else {
				editor.textContent = value;
			}
			editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
			const send = Array.from(document.querySelectorAll("button, [role=button]"))
				.find((candidate) => (candidate.textContent || "").trim().toLowerCase() === "send");
			if (!send) return false;
			(send as HTMLElement).click();
			return true;
		})()`);
	}

	async messageAppeared(body: string): Promise<boolean> {
		return this.evaluate<boolean>(
			`(document.body?.innerText || "").includes(${JSON.stringify(body)})`,
		);
	}
}

async function pageForPort(port: number): Promise<CdpPage> {
	const response = await fetch(`http://127.0.0.1:${port}/json/list`);
	if (!response.ok) throw new Error("CDP_TARGET_LIST_UNAVAILABLE");
	const targets = (await response.json()) as CdpTarget[];
	const target = targets.find(
		(item) =>
			item.type === "page" &&
			item.webSocketDebuggerUrl &&
			/linkedin\.com/i.test(item.url ?? ""),
	);
	if (!target?.webSocketDebuggerUrl) throw new Error("LINKEDIN_PAGE_NOT_FOUND");
	return CdpPage.connect(target.webSocketDebuggerUrl);
}

async function waitForConnectionRequestModal(
	page: CdpPage,
	action: LinkedInConnectionRequestModalAction,
	target: LinkedInBrowserAction["target"],
): Promise<ConnectionRequestModalInspection> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const inspection = await page.inspectConnectionRequestModal(action, target);
		if (inspection.status !== "NONE") return inspection;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	return { status: "NONE", challenge: null };
}

async function waitForMessageComposer(
	page: CdpPage,
	expectedRecipientIdentifier: string | null,
	expectedExternalConversationKey: string | null,
): Promise<MessageComposerInspection> {
	return waitForStableLinkedInMessageComposer(() =>
		page.inspectMessageComposer(
			expectedRecipientIdentifier,
			expectedExternalConversationKey,
		),
	);
}

function proofFor(
	action: LinkedInBrowserAction,
	observation: PageObservation,
): Record<string, unknown> {
	return {
		adapter: "chrome-devtools-protocol",
		profileUrl: observation.profileUrl,
		profileIdentifier: observation.profileIdentifier,
		displayName: observation.displayName,
		relationshipState: observation.relationshipState,
		pendingInvitationState: observation.pendingInvitationState,
		externalConversationKey: observation.externalConversationKey,
		conversationParticipantIdentifier:
			observation.conversationParticipantIdentifier,
		profileHeadingCandidateCount: observation.profileHeadingCandidates.length,
		hiddenProfileHeadingCount: observation.profileHeadingCandidates.filter(
			(heading) => !heading.visible,
		).length,
		profileHeadingCandidates: observation.profileHeadingCandidates
			.filter((heading) => heading.visible)
			.slice(0, 12),
		pageUrl: observation.href,
		action: action.action,
	};
}

export class CdpLinkedInBrowserAdapter implements LinkedInBrowserAdapter {
	constructor(private readonly port = 9222) {}

	async inspectComposerReadiness(
		url: string,
		expectedRecipientIdentifier: string,
	): Promise<MessageComposerInspection> {
		const destination = new URL(url);
		if (
			destination.origin !== "https://www.linkedin.com" ||
			destination.pathname !== "/messaging/compose/" ||
			destination.searchParams.get("recipient") !==
				expectedRecipientIdentifier ||
			destination.searchParams.get("profileUrn") !==
				`urn:li:fsd_profile:${expectedRecipientIdentifier}`
		)
			throw new Error("INVALID_COMPOSER_PROBE_TARGET");
		const page = await pageForPort(this.port);
		try {
			const before = await page.observe();
			if (before.challenge || !before.authenticated)
				throw new Error(before.challenge ?? "LINKEDIN_LOGIN_REQUIRED");
			await page.navigate(destination.href);
			return await waitForMessageComposer(
				page,
				expectedRecipientIdentifier,
				null,
			);
		} finally {
			await page.close();
		}
	}

	async health(): Promise<LinkedInBrowserHealth> {
		let page: CdpPage;
		try {
			page = await pageForPort(this.port);
		} catch (error) {
			return {
				status: "UNAVAILABLE",
				detail: error instanceof Error ? error.message : "CDP_UNAVAILABLE",
				url: null,
				title: null,
			};
		}
		try {
			const observation = await page.observe();
			if (observation.challenge)
				return {
					status: "CHALLENGE",
					detail: observation.challenge,
					url: observation.href,
					title: observation.title,
				};
			if (!observation.authenticated)
				return {
					status: "UNAUTHENTICATED",
					detail: "LINKEDIN_LOGIN_REQUIRED",
					url: observation.href,
					title: observation.title,
				};
			return {
				status: "READY",
				detail: "LINKEDIN_BROWSER_AUTHENTICATED",
				url: observation.href,
				title: observation.title,
			};
		} finally {
			await page.close();
		}
	}

	async execute(
		action: LinkedInBrowserAction,
	): Promise<LinkedInBrowserOutcome> {
		let page: CdpPage;
		let writeStarted = false;
		try {
			page = await pageForPort(this.port);
		} catch (error) {
			return {
				status: "FAILED",
				errorCode:
					error instanceof Error ? error.message : "BROWSER_UNAVAILABLE",
				observedAt: new Date(),
			};
		}
		try {
			await page.navigate(action.target.profileUrl);
			await new Promise((resolve) => setTimeout(resolve, 500));
			const before = await page.observe();
			if (before.challenge)
				return {
					status: "AMBIGUOUS",
					errorCode: before.challenge.includes("captcha")
						? "CAPTCHA"
						: "SECURITY_CHALLENGE",
					observedAt: new Date(),
				};
			if (!before.authenticated)
				return {
					status: "FAILED",
					errorCode: "LINKEDIN_UNAUTHENTICATED",
					observedAt: new Date(),
				};
			const preflight = verifyLinkedInActionState(action, before);
			if (!preflight.allowed)
				return {
					status: "FAILED",
					errorCode: preflight.reason,
					browserProof: {
						phase: "profile-preflight",
						reason: preflight.reason,
						expected: {
							contactId: action.target.contactId,
							routeId: action.target.routeId,
							profileUrl: action.target.profileUrl,
							profileIdentifier: action.target.profileIdentifier,
							stableMemberIdentifier:
								action.target.stableMemberIdentifier ?? null,
							displayName: action.target.displayName ?? null,
							externalConversationKey:
								action.target.externalConversationKey ?? null,
						},
						observed: proofFor(action, before),
					},
					observedAt: new Date(),
				};
			if (action.action === "CONNECTION_REQUEST") {
				writeStarted = true;
				const connect = await page.clickConnectionControl(before);
				if (!connect.clicked)
					return {
						status: "FAILED",
						errorCode: "CONNECT_BUTTON_UNAVAILABLE",
						observedAt: new Date(),
					};
				const modalAction = action.note ? "ADD_NOTE" : "SEND_WITHOUT_NOTE";
				let modal = await waitForConnectionRequestModal(
					page,
					modalAction,
					action.target,
				);
				if (modal.status === "NONE" && connect.inviteHref) {
					if (
						!(await page.navigateToInvite(
							connect.inviteHref,
							action.target.profileUrl,
						))
					)
						return {
							status: "AMBIGUOUS",
							errorCode: "SEND_STATE_UNCLEAR",
							observedAt: new Date(),
						};
					await new Promise((resolve) => setTimeout(resolve, 500));
					modal = await waitForConnectionRequestModal(
						page,
						modalAction,
						action.target,
					);
				}
				if (modal.status === "CHALLENGE")
					return {
						status: "AMBIGUOUS",
						errorCode: "LINKEDIN_WARNING",
						observedAt: new Date(),
					};
				if (modal.status !== "FOUND")
					return {
						status: "AMBIGUOUS",
						errorCode: "SEND_STATE_UNCLEAR",
						observedAt: new Date(),
					};
				if (action.note) {
					const noteOpened = await page.clickConnectionRequestModalControl(
						"ADD_NOTE",
						action.target,
					);
					if (noteOpened.status !== "FOUND")
						return {
							status: "AMBIGUOUS",
							errorCode: "SEND_STATE_UNCLEAR",
							observedAt: new Date(),
						};
					if (!(await page.fillAndSend(action.note)))
						return {
							status: "AMBIGUOUS",
							errorCode: "SEND_STATE_UNCLEAR",
							observedAt: new Date(),
						};
				} else {
					const sent = await page.clickConnectionRequestModalControl(
						"SEND_WITHOUT_NOTE",
						action.target,
					);
					if (sent.status !== "FOUND")
						return {
							status: "AMBIGUOUS",
							errorCode: "SEND_STATE_UNCLEAR",
							observedAt: new Date(),
						};
				}
				await new Promise((resolve) => setTimeout(resolve, 700));
				if (await page.isOnInviteRoute()) {
					await page.navigate(action.target.profileUrl);
					await new Promise((resolve) => setTimeout(resolve, 500));
				}
				const after = await page.observe();
				if (after.challenge)
					return {
						status: "AMBIGUOUS",
						errorCode: "LINKEDIN_WARNING",
						observedAt: new Date(),
					};
				if (after.relationshipState !== "PENDING")
					return {
						status: "AMBIGUOUS",
						errorCode: "SEND_STATE_UNCLEAR",
						observedAt: new Date(),
					};
				return {
					status: "CONFIRMED",
					browserProof: proofFor(action, after),
					observedIdentity: after,
					observedAt: new Date(),
				};
			}
			const messageControl = await page.clickRelationshipControl(
				"MESSAGE",
				before,
			);
			if (!messageControl.clicked)
				return {
					status: "FAILED",
					errorCode: "MESSAGE_BUTTON_UNAVAILABLE",
					browserProof: {
						phase: "profile-message-control",
						expected: {
							contactId: action.target.contactId,
							routeId: action.target.routeId,
							profileUrl: action.target.profileUrl,
							profileIdentifier: action.target.profileIdentifier,
							externalConversationKey:
								action.target.externalConversationKey ?? null,
						},
						observed: proofFor(action, before),
					},
					observedAt: new Date(),
				};
			if (
				action.target.externalConversationKey &&
				messageControl.externalConversationKey &&
				!linkedInConversationIdentityMatches(action.target, {
					externalConversationKey: messageControl.externalConversationKey,
					conversationParticipantIdentifier: messageControl.recipientIdentifier,
				})
			)
				return {
					status: "AMBIGUOUS",
					errorCode: "WRONG_CONVERSATION",
					browserProof: {
						phase: "profile-message-control-conversation-mismatch",
						expectedContactId: action.target.contactId,
						expectedRouteId: action.target.routeId,
						expectedProfileUrl: action.target.profileUrl,
						expectedExternalConversationKey:
							action.target.externalConversationKey,
						observedControlHrefConversationKey:
							messageControl.externalConversationKey,
						observedRecipientIdentifier: messageControl.recipientIdentifier,
						page: proofFor(action, before),
					},
					observedAt: new Date(),
				};
			const expectedExternalConversationKey =
				action.target.externalConversationKey ??
				messageControl.externalConversationKey ??
				null;
			const composer = await waitForMessageComposer(
				page,
				messageControl.recipientIdentifier,
				expectedExternalConversationKey,
			);
			if (composer.status === "AMBIGUOUS")
				return {
					status: "AMBIGUOUS",
					errorCode: "WRONG_CONVERSATION",
					browserProof: {
						phase: "composer-resolution",
						contactId: action.target.contactId,
						routeId: action.target.routeId,
						expectedRecipientIdentifier: messageControl.recipientIdentifier,
						expectedExternalConversationKey,
						observedControlHrefConversationKey:
							messageControl.externalConversationKey,
						composerDiagnostics: await page.inspectMessageComposerDiagnostics(),
						page: proofFor(action, before),
					},
					observedAt: new Date(),
				};
			if (composer.status !== "FOUND")
				return {
					status: "FAILED",
					errorCode: "MESSAGE_EDITOR_UNAVAILABLE",
					browserProof: {
						phase: "pre-send-composer-availability",
						composer,
						contactId: action.target.contactId,
						routeId: action.target.routeId,
						expectedRecipientIdentifier: messageControl.recipientIdentifier,
						expectedExternalConversationKey,
						observedControlHrefConversationKey:
							messageControl.externalConversationKey,
						composerDiagnostics: await page.inspectMessageComposerDiagnostics(),
						page: proofFor(action, before),
					},
					observedAt: new Date(),
				};
			if (
				!firstMessageBrowserStateAllowsSend(action.target, {
					externalMessageKey: composer.externalMessageKey,
				})
			)
				return {
					status: "AMBIGUOUS",
					errorCode: "WRONG_CONVERSATION",
					browserProof: {
						phase: "target-surface-history",
						contactId: action.target.contactId,
						routeId: action.target.routeId,
						externalMessageKey: composer.externalMessageKey,
						externalConversationKey: composer.externalConversationKey,
						recipientIdentifier: composer.recipientIdentifier,
						composerDiagnostics: await page.inspectMessageComposerDiagnostics(),
					},
					observedAt: new Date(),
				};
			writeStarted = true;
			const filled = action.body
				? await page.fillAndSend(
						action.body,
						composer.recipientIdentifier,
						composer.externalConversationKey ?? expectedExternalConversationKey,
					)
				: false;
			if (filled === "AMBIGUOUS")
				return {
					status: "AMBIGUOUS",
					errorCode: "WRONG_CONVERSATION",
					browserProof: {
						phase: "final-compose-resolution",
						expectedRecipientIdentifier: composer.recipientIdentifier,
						expectedExternalConversationKey:
							composer.externalConversationKey ??
							expectedExternalConversationKey,
						composerDiagnostics: await page.inspectMessageComposerDiagnostics(),
					},
					observedAt: new Date(),
				};
			if (!filled)
				return {
					status: "AMBIGUOUS",
					errorCode: "MESSAGE_EDITOR_UNAVAILABLE",
					browserProof: {
						phase: "post-resolution-editor-or-send-control",
						recipientIdentifier: composer.recipientIdentifier,
						composerDiagnostics: await page.inspectMessageComposerDiagnostics(),
					},
					observedAt: new Date(),
				};
			await new Promise((resolve) => setTimeout(resolve, 700));
			const after = await page.observe();
			if (after.challenge)
				return {
					status: "AMBIGUOUS",
					errorCode: "LINKEDIN_WARNING",
					observedAt: new Date(),
				};
			if (!(await page.messageAppeared(action.body ?? "")))
				return {
					status: "AMBIGUOUS",
					errorCode: "SEND_STATE_UNCLEAR",
					observedAt: new Date(),
				};
			const observedIdentity = {
				...before,
				...after,
				resolution: "RESOLVED" as const,
				profileUrl: before.profileUrl,
				profileIdentifier: before.profileIdentifier,
				displayName: before.displayName,
				relationshipState: "CONNECTED" as const,
				externalConversationKey:
					after.externalConversationKey ?? composer.externalConversationKey,
				conversationParticipantIdentifier:
					after.conversationParticipantIdentifier ??
					composer.recipientIdentifier,
			};
			return {
				status: "CONFIRMED",
				externalMessageKey: after.externalMessageKey,
				externalConversationKey:
					action.target.externalConversationKey ??
					after.externalConversationKey ??
					composer.externalConversationKey,
				browserProof: proofFor(action, observedIdentity),
				observedIdentity,
				observedAt: new Date(),
			};
		} catch (error) {
			return writeStarted
				? {
						status: "AMBIGUOUS",
						errorCode: "SEND_STATE_UNCLEAR",
						observedAt: new Date(),
					}
				: {
						status: "FAILED",
						errorCode:
							error instanceof Error
								? error.message
								: "BROWSER_EXECUTION_FAILED",
						observedAt: new Date(),
					};
		} finally {
			await page.close();
		}
	}
}
