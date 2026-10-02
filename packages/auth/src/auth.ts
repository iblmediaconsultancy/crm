import { db } from "@crm/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins/organization";
import { workspaceAccess, workspaceRoles } from "./access";
import { AUTH_COOKIE_PREFIX } from "./cookies";
import { env } from "./env";
import { ensureWorkspaceMembership } from "./organization";
import { enqueueSystemEmail, stableSystemEmailKey } from "./system-email";
export const auth = betterAuth({
	appName: "IBL Command Center",
	baseURL: env.apiUrl,

	database: prismaAdapter(db, {
		provider: "postgresql",
	}),

	emailAndPassword: {
		enabled: true,
		disableSignUp: true,
		sendResetPassword: async ({ user, url }) => {
			const authUrl = new URL(url);
			const publicUrl = new URL(
				`${authUrl.pathname}${authUrl.search}`,
				env.appUrl,
			);
			const callbackUrl = publicUrl.searchParams.get("callbackURL");
			if (callbackUrl) {
				publicUrl.searchParams.set(
					"callbackURL",
					new URL(callbackUrl, env.appUrl).toString(),
				);
			}
			const publicUrlString = publicUrl.toString();

			await enqueueSystemEmail({
				actorUserId: user.id,
				to: user.email,
				subject: "Reset your IBL Command Center password",
				text: `Open this secure link to reset your password: ${publicUrlString}`,
				idempotencyKey: stableSystemEmailKey("PASSWORD_RESET", publicUrlString),
				kind: "PASSWORD_RESET",
			});
		},
	},

	account: {
		accountLinking: { enabled: false },
	},

	session: {
		expiresIn: 60 * 60 * 24 * 7,
		updateAge: 60 * 60 * 24,
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60,
		},
	},

	rateLimit: {
		enabled: true,
		storage: "database",
	},

	advanced: {
		cookiePrefix: AUTH_COOKIE_PREFIX,

		useSecureCookies: env.isProduction,
		...(env.cookieDomain && {
			crossSubDomainCookies: {
				enabled: true,
				domain: env.cookieDomain,
			},
		}),
	},

	trustedOrigins: [...env.trustedOrigins],
	hooks: {},

	plugins: [
		organization({
			allowUserToCreateOrganization: false,
			disableOrganizationDeletion: true,
			creatorRole: "admin",
			ac: workspaceAccess,
			roles: workspaceRoles,
			sendInvitationEmail: async ({ id, email, organization, inviter }) => {
				const url = `${env.appUrl}/accept-invitation?id=${encodeURIComponent(id)}`;
				await enqueueSystemEmail({
					actorUserId: inviter.userId,
					to: email,
					subject: `Invitation to ${organization.name}`,
					text: `${inviter.user.name} invited you to ${organization.name}. Accept the invitation: ${url}`,
					idempotencyKey: stableSystemEmailKey("INVITATION", id),
					kind: "INVITATION",
				});
			},

			schema: {
				organization: {
					additionalFields: {
						website: {
							type: "string",
							required: false,
						},
					},
				},
			},
		}),
	],

	databaseHooks: {
		user: {
			create: {
				before: async () => {
					throw new APIError("FORBIDDEN", {
						message: "IBL Command Center is invite-only.",
					});
				},
			},
		},

		session: {
			create: {
				before: async (session) => {
					const workspaceId = await ensureWorkspaceMembership(session.userId);

					return {
						data: { ...session, activeOrganizationId: workspaceId ?? null },
					};
				},
			},
		},
	},
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
export type SessionUser = Session["user"];
