import { plainToInstance, Type } from "class-transformer";
import {
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	IsUrl,
	Max,
	Min,
	MinLength,
	validateSync,
} from "class-validator";

export enum NodeEnv {
	Development = "development",
	Production = "production",
	Test = "test",
}

export class EnvironmentVariables {
	@IsEnum(NodeEnv)
	NODE_ENV: NodeEnv = NodeEnv.Development;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(65535)
	PORT = 3001;

	@IsString()
	@MinLength(1)
	DATABASE_URL!: string;

	@IsOptional()
	@IsString()
	@MinLength(32)
	BETTER_AUTH_SECRET?: string;

	@IsString()
	@MinLength(1)
	ALLOWED_SIGN_IN!: string;

	@IsOptional()
	@IsUrl({ require_tld: false })
	API_URL?: string;

	@IsOptional()
	@IsString()
	APP_URL?: string;

	@IsOptional()
	@IsString()
	AUTH_COOKIE_DOMAIN?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	CACHE_TTL_MS?: number;

	@IsOptional()
	@IsString()
	@MinLength(16)
	CRON_SECRET?: string;

	@IsOptional()
	@IsString()
	BLOB_READ_WRITE_TOKEN?: string;

	@IsOptional()
	@IsUrl({ require_tld: false, require_protocol: true })
	AGENT_URL?: string;

	@IsOptional()
	@IsString()
	AGENT_BRIDGE_SECRET?: string;

	@IsOptional()
	@IsString()
	GOOGLE_GENERATIVE_AI_API_KEY?: string;

	@IsOptional()
	@IsString()
	CRM_TELEMETRY_DISABLED?: string;

	@IsOptional()
	@IsString()
	MIAB_IMAP_HOST?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(993)
	@Max(993)
	MIAB_IMAP_PORT?: number;

	@IsOptional()
	@IsString()
	MIAB_MAILBOX_CREDENTIALS_JSON?: string;

	@IsOptional()
	@IsString()
	MIAB_MAILBOX_CREDENTIALS_FILE?: string;

	@IsOptional()
	@IsString()
	RESEND_API_KEY?: string;

	@IsOptional()
	@IsString()
	RESEND_API_KEY_FILE?: string;

	@IsOptional()
	@IsString()
	RESEND_WEBHOOK_SECRET_FILE?: string;

	@IsOptional()
	@IsString()
	OBJECT_STORAGE_ACCESS_KEY_FILE?: string;

	@IsOptional()
	@IsString()
	OBJECT_STORAGE_SECRET_KEY_FILE?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	API_RATE_LIMIT_MAX?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1_000)
	API_RATE_LIMIT_WINDOW_MS?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1_000)
	WORKER_INTERVAL_MS?: number;

	@IsOptional()
	@IsString()
	RESEND_SYSTEM_FROM_EMAIL?: string;

	@IsOptional()
	@IsString()
	RESEND_SYSTEM_FROM_NAME?: string;

	@IsOptional()
	@IsString()
	RESEND_OUTREACH_FROM_EMAIL?: string;

	@IsOptional()
	@IsString()
	RESEND_OUTREACH_FROM_NAME?: string;

	@IsOptional()
	@IsString()
	IBL_LOCAL_PROVIDER_DOUBLE?: string;
}

export function validateEnv(
	config: Record<string, unknown>,
): EnvironmentVariables {
	const validated = plainToInstance(EnvironmentVariables, config, {
		enableImplicitConversion: true,
		exposeDefaultValues: true,
	});
	const errors = validateSync(validated, {
		skipMissingProperties: false,
		whitelist: false,
	});
	if (errors.length > 0) {
		const details = errors
			.map((error) => Object.values(error.constraints ?? {}).join(", "))
			.join("\n  - ");
		throw new Error(
			`Invalid environment configuration:\n  - ${details}\n\nSee .env.example at the root of the repo.`,
		);
	}
	validateProductionGroups(config);
	return validated;
}

function validateProductionGroups(config: Record<string, unknown>) {
	if (
		config.IBL_LOCAL_PROVIDER_DOUBLE === "enabled" &&
		config.NODE_ENV === NodeEnv.Production
	) {
		throw new Error(
			"IBL_LOCAL_PROVIDER_DOUBLE cannot be enabled in production.",
		);
	}
	if (config.NODE_ENV !== NodeEnv.Production) return;
	for (const inline of [
		"MIAB_MAILBOX_CREDENTIALS_JSON",
		"RESEND_API_KEY",
		"OBJECT_STORAGE_ACCESS_KEY",
		"OBJECT_STORAGE_SECRET_KEY",
	]) {
		if (typeof config[inline] === "string" && String(config[inline]).trim()) {
			throw new Error(
				`${inline} must be supplied through a file secret in production.`,
			);
		}
	}
	const identity = String(config.IBL_DATABASE_IDENTITY ?? "");
	const requireGroup = (names: string[], label: string) => {
		const missing = names.filter(
			(name) =>
				typeof config[name] !== "string" || !String(config[name]).trim(),
		);
		if (missing.length) {
			throw new Error(
				`${label} configuration is incomplete: ${missing.join(", ")}`,
			);
		}
	};
	if (identity === "api") {
		requireGroup(
			["BETTER_AUTH_SECRET", "RESEND_WEBHOOK_SECRET_FILE"],
			"API security",
		);
	}
	if (identity === "worker") {
		requireGroup(["MIAB_IMAP_HOST", "MIAB_MAILBOX_CREDENTIALS_FILE"], "MIAB");
		requireGroup(
			[
				"RESEND_API_KEY_FILE",
				"RESEND_SYSTEM_FROM_EMAIL",
				"RESEND_OUTREACH_FROM_EMAIL",
			],
			"Resend",
		);
		requireGroup(
			[
				"OBJECT_STORAGE_ENDPOINT",
				"OBJECT_STORAGE_REGION",
				"OBJECT_STORAGE_BUCKET",
				"OBJECT_STORAGE_ACCESS_KEY_FILE",
				"OBJECT_STORAGE_SECRET_KEY_FILE",
				"CLAMAV_HOST",
			],
			"Attachment storage and scanning",
		);
	}
}
