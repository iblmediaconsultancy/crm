import { createHash } from "node:crypto";
import { db, Prisma, type ProviderCapabilityKey } from "@crm/db";
import {
	EnvironmentMiabCredentialSource,
	EnvironmentResendCredentialSource,
} from "../src/providers/provider-credentials";
import { TlsMiabProtocolClient } from "../src/providers/miab-imap.client";
import { HttpResendTransport } from "../src/providers/resend-transport";

const args = new Set(process.argv.slice(2));
if (!args.has("--confirm-controlled-provider-probes")) {
	throw new Error(
		"Refusing provider network access. Pass --confirm-controlled-provider-probes after operator review.",
	);
}
const requested = [
	args.has("--miab") ? "MIAB_IMAP" : null,
	args.has("--resend") ? "RESEND_OUTBOUND" : null,
].filter(Boolean) as ProviderCapabilityKey[];
if (!requested.length) throw new Error("Select --miab and/or --resend.");
const operatorUserId = required("PROVIDER_OPERATOR_USER_ID");
const admin = await db.member.findFirst({
	where: {
		organizationId: "workspace",
		userId: operatorUserId,
		role: "admin",
		user: { profile: { status: "ACTIVE" } },
	},
	select: { userId: true },
});
if (!admin)
	throw new Error("PROVIDER_OPERATOR_USER_ID is not an active Admin.");

for (const capability of requested) {
	const result =
		capability === "MIAB_IMAP" ? await verifyMiab() : await verifyResend();
	await db.$transaction(
		async (tx) => {
			const evidence = await tx.providerEvidence.create({
				data: {
					capability,
					probeKind: result.probeKind,
					outcome: "VERIFIED",
					evidence: result.evidence,
					configurationDigest: result.configurationDigest,
					operatorUserId,
				},
			});
			await tx.providerCapability.upsert({
				where: { key: capability },
				create: {
					key: capability,
					status: "VERIFIED",
					evidenceReference: evidence.id,
					verifiedAt: new Date(),
				},
				update: {
					status: "VERIFIED",
					evidenceReference: evidence.id,
					verifiedAt: new Date(),
				},
			});
			await tx.securityAuditEvent.create({
				data: {
					actorUserId: operatorUserId,
					action: "PROVIDER_CAPABILITY_VERIFIED",
					resourceType: "ProviderCapability",
					resourceId: capability,
					outcome: "SUCCESS",
					metadata: { evidenceId: evidence.id },
				},
			});
		},
		{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
	);
	console.log(JSON.stringify({ capability, verified: true }));
}
await db.$disconnect();

async function verifyMiab() {
	const address = required("MIAB_VERIFICATION_MAILBOX").toLowerCase();
	const credentials = await new EnvironmentMiabCredentialSource().load(address);
	const client = new TlsMiabProtocolClient();
	try {
		await client.connect(credentials);
		const capabilities = (await client.capabilities()).sort();
		const folders = await client.folders();
		return {
			probeKind: "READ_ONLY_IMAP_TLS",
			configurationDigest: digest({
				host: credentials.host,
				port: credentials.port,
				usernameHash: digest(address),
			}),
			evidence: {
				tlsCertificateVerification: true,
				readOnly: true,
				capabilities,
				folderCount: folders.length,
			},
		};
	} finally {
		await client.close();
	}
}

async function verifyResend() {
	const apiKey = (await new EnvironmentResendCredentialSource().load()).apiKey;
	const recipient = required("RESEND_VERIFICATION_RECIPIENT");
	const senders = [
		{
			purpose: "system",
			address: required("RESEND_SYSTEM_FROM_EMAIL"),
			displayName:
				process.env.RESEND_SYSTEM_FROM_NAME?.trim() || "IBL Command Center",
		},
		{
			purpose: "outreach",
			address: required("RESEND_OUTREACH_FROM_EMAIL"),
			displayName:
				process.env.RESEND_OUTREACH_FROM_NAME?.trim() ||
				"IBL Media Consultancy",
		},
	] as const;
	const transport = new HttpResendTransport();
	const results = [] as Array<{
		purpose: string;
		senderHash: string;
		providerMessageIdHash: string;
	}>;
	for (const sender of senders) {
		const sent = await transport.send(apiKey, {
			from: { address: sender.address, displayName: sender.displayName },
			to: recipient,
			subject: `IBL Command Center controlled ${sender.purpose} sender verification`,
			text: `This operator-authorized message verifies the gated Resend ${sender.purpose} sender.`,
			idempotencyKey: `ibl-provider-verification:${sender.purpose}:${digest(`${sender.address}:${recipient}`).slice(0, 32)}`,
		});
		results.push({
			purpose: sender.purpose,
			senderHash: digest(sender.address.toLowerCase()),
			providerMessageIdHash: digest(sent.providerMessageId),
		});
	}
	return {
		probeKind: "CONTROLLED_RESEND_DELIVERY",
		configurationDigest: digest({
			senders: senders.map((sender) => sender.address),
			recipientHash: digest(recipient.toLowerCase()),
		}),
		evidence: { controlledRecipient: true, senders: results },
	};
}
function required(name: string) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required.`);
	return value;
}
function digest(value: unknown) {
	return createHash("sha256")
		.update(typeof value === "string" ? value : JSON.stringify(value))
		.digest("hex");
}
