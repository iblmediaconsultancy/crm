import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function keyFromSecret(secret: string): Buffer {
	return createHash("sha256").update(secret).digest();
}

export function encryptGoogleCalendarToken(
	value: string,
	secret: string,
): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
	const encrypted = Buffer.concat([
		cipher.update(value, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();
	return `${PREFIX}${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptGoogleCalendarToken(
	value: string,
	secret: string,
): string {
	if (!value.startsWith(PREFIX)) throw new Error("GOOGLE_TOKEN_FORMAT_INVALID");
	const encoded = value.slice(PREFIX.length).split(":");
	if (encoded.length !== 3) throw new Error("GOOGLE_TOKEN_FORMAT_INVALID");
	const [ivValue, authTagValue, encryptedValue] = encoded;
	const iv = Buffer.from(ivValue ?? "", "base64url");
	const authTag = Buffer.from(authTagValue ?? "", "base64url");
	const encrypted = Buffer.from(encryptedValue ?? "", "base64url");
	if (
		iv.length !== IV_BYTES ||
		authTag.length !== AUTH_TAG_BYTES ||
		encrypted.length === 0
	) {
		throw new Error("GOOGLE_TOKEN_FORMAT_INVALID");
	}
	const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
		"utf8",
	);
}
