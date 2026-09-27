export const ATLAS_OUTREACH_SENDER = {
	address: "outreach@iblmedia.com",
	displayName: "IBL Media Team",
} as const;

export function resolveAtlasOutreachSender() {
	const configuredAddress = process.env.RESEND_OUTREACH_FROM_EMAIL?.trim();
	const configuredName = process.env.RESEND_OUTREACH_FROM_NAME?.trim();

	if (
		configuredAddress &&
		configuredAddress.toLowerCase() !== ATLAS_OUTREACH_SENDER.address
	)
		throw new Error("RESEND_OUTREACH_SENDER_MISMATCH");
	if (configuredName && configuredName !== ATLAS_OUTREACH_SENDER.displayName)
		throw new Error("RESEND_OUTREACH_SENDER_NAME_MISMATCH");

	return ATLAS_OUTREACH_SENDER;
}
