import {
	type LinkedInBrowserAction,
	type LinkedInBrowserAdapter,
	type LinkedInBrowserIdentityEvidence,
	type LinkedInBrowserOutcome,
	type LinkedInRelationshipState,
	linkedInConversationIdentityMatches,
	verifyLinkedInActionState,
} from "@crm/db/linkedin-browser-adapter";
import {
	type LinkedInConnectionRequestModal,
	type LinkedInConnectionRequestModalAction,
	resolveLinkedInConnectionRequestModalControl,
} from "./connection-request-modal-resolver";
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
	controls: LinkedInRelationshipControl[];
};

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

function collectLinkedInRelationshipControls(includeElements = false) {
	const body = document.body?.innerText || "";
	const href = location.href;
	const title = document.title || "";
	const profileMatch = href.match(
		/https?:\/\/(?:www\.)?linkedin\.com\/in\/([^/?#]+)/i,
	);
	const displayName =
		Array.from(document.querySelectorAll("h1, h2"))
			.filter(
				(element) => !element.closest("[data-testid=toasts-title], dialog"),
			)
			.map((element) => (element.textContent || "").trim())
			.find(Boolean) || null;
	const profileSection = Array.from(document.querySelectorAll("section")).find(
		(element) => displayName && (element.innerText || "").includes(displayName),
	);
	const elements = profileSection
		? Array.from(profileSection.querySelectorAll("button, a[role=button], a"))
		: [];
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
	const conversationParticipantIdentifiers = Array.from(
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
	const challenge =
		/captcha|security check|verify your identity|identity verification|unusual activity|unusual login|security checkpoint|suspicious activity|account restricted|rate limit|temporarily unavailable/.exec(
			`${body.toLowerCase()} ${title.toLowerCase()}`,
		)?.[0] || null;
	const authenticated =
		!/(?:\/login|\/checkpoint)\b/i.test(href) &&
		!/sign in to linkedin/.test(body.toLowerCase());
	const conversationMatch = href.match(/\/messaging\/thread\/([^/?#]+)/i);
	const messageKey =
		document
			.querySelector("[data-message-urn], [data-message-id]")
			?.getAttribute("data-message-urn") ||
		document
			.querySelector("[data-message-id]")
			?.getAttribute("data-message-id") ||
		null;
	return {
		resolution: profileMatch ? "RESOLVED" : "AMBIGUOUS",
		profileUrl: profileMatch
			? `https://www.linkedin.com/in/${profileMatch[1]}/`
			: null,
		profileIdentifier: profileMatch?.[1] || null,
		displayName,
		externalConversationKey: conversationMatch?.[1] || null,
		conversationParticipantIdentifier:
			conversationParticipantIdentifiers.length === 1
				? conversationParticipantIdentifiers[0]
				: null,
		href,
		title,
		challenge,
		authenticated,
		externalMessageKey: messageKey,
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
		const observation = await this.evaluate<PageObservation>(
			`(() => { const collectControls = ${collect}; return collectControls(); })()`,
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
	): Promise<boolean> {
		const collect = collectLinkedInRelationshipControls.toString();
		const resolve = resolveLinkedInRelationshipControl.toString();
		return this.evaluate<boolean>(`(() => {
			const collectControls = ${collect};
			const resolveControl = ${resolve};
			const snapshot = collectControls(true);
			const resolution = resolveControl({
				action: ${JSON.stringify(action)},
				profileIdentifier: ${JSON.stringify(observation.profileIdentifier)},
				displayName: ${JSON.stringify(observation.displayName)},
				controls: snapshot.controls,
			});
			if (resolution.status !== "FOUND") return false;
			const index = resolution.control.elementIndex;
			const element = snapshot.elements?.[index];
			const control = snapshot.controls[index];
			if (!element || !control || !element.isConnected || !control.connected || !control.visible) return false;
			element.click();
			return true;
		})()`);
	}

	async clickConnectionControl(
		observation: PageObservation,
	): Promise<{ clicked: boolean; inviteHref: string | null }> {
		const collect = collectLinkedInRelationshipControls.toString();
		const resolve = resolveLinkedInRelationshipControl.toString();
		return this.evaluate<{
			clicked: boolean;
			inviteHref: string | null;
		}>(`(() => {
			const collectControls = ${collect};
			const resolveControl = ${resolve};
			const snapshot = collectControls(true);
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

	async fillAndSend(body: string): Promise<boolean> {
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
		pageUrl: observation.href,
		action: action.action,
	};
}

export class CdpLinkedInBrowserAdapter implements LinkedInBrowserAdapter {
	constructor(private readonly port = 9222) {}

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
			if (!(await page.clickRelationshipControl("MESSAGE", before)))
				return {
					status: "FAILED",
					errorCode: "MESSAGE_BUTTON_UNAVAILABLE",
					observedAt: new Date(),
				};
			await new Promise((resolve) => setTimeout(resolve, 500));
			const thread = await page.observe();
			if (!linkedInConversationIdentityMatches(action.target, thread))
				return {
					status: "AMBIGUOUS",
					errorCode: "WRONG_CONVERSATION",
					observedAt: new Date(),
				};
			writeStarted = true;
			if (!action.body || !(await page.fillAndSend(action.body)))
				return {
					status: "FAILED",
					errorCode: "MESSAGE_EDITOR_UNAVAILABLE",
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
			if (!(await page.messageAppeared(action.body)))
				return {
					status: "AMBIGUOUS",
					errorCode: "SEND_STATE_UNCLEAR",
					observedAt: new Date(),
				};
			const observedIdentity = {
				...before,
				...after,
				profileUrl: after.profileUrl ?? before.profileUrl,
				profileIdentifier: after.profileIdentifier ?? before.profileIdentifier,
				displayName: after.displayName ?? before.displayName,
				relationshipState: "CONNECTED" as const,
			};
			return {
				status: "CONFIRMED",
				externalMessageKey: after.externalMessageKey,
				externalConversationKey:
					action.target.externalConversationKey ??
					after.externalConversationKey ??
					thread.externalConversationKey,
				browserProof: proofFor(action, after),
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
