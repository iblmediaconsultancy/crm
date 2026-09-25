export const LOCAL_LINKEDIN_EXECUTOR_GATE =
	"ATLAS_LINKEDIN_LOCAL_EXECUTOR_ENABLED";

export type LocalLinkedInDatabaseTarget = {
	hostname: string;
	port: number;
	database: string;
	isLocal: boolean;
	isAuthoritative: boolean;
};

export function localLinkedInExecutorEnabled(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return env[LOCAL_LINKEDIN_EXECUTOR_GATE] === "true";
}

export function localLinkedInExecutorGateState(
	env: NodeJS.ProcessEnv = process.env,
) {
	const value = env[LOCAL_LINKEDIN_EXECUTOR_GATE];
	return {
		name: LOCAL_LINKEDIN_EXECUTOR_GATE,
		configured: value !== undefined,
		enabled: value === "true",
	};
}

export function localLinkedInDatabaseTarget(
	databaseUrl: string,
): LocalLinkedInDatabaseTarget {
	const parsed = new URL(databaseUrl);
	const hostname = parsed.hostname.toLowerCase();
	const port = parsed.port ? Number(parsed.port) : 5432;
	const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
	const isLocal = hostname === "127.0.0.1" || hostname === "localhost";
	return {
		hostname,
		port,
		database,
		isLocal,
		isAuthoritative: isLocal && port === 5432 && database === "crm",
	};
}

export function assertLocalLinkedInDatabaseAccess(options: {
	databaseUrl: string | undefined;
	allowDisposableDatabase: boolean;
	env?: NodeJS.ProcessEnv;
	worker: boolean;
}): LocalLinkedInDatabaseTarget {
	if (!options.databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
	const target = localLinkedInDatabaseTarget(options.databaseUrl);
	if (!target.isLocal) throw new Error("LOCAL_EXECUTOR_DATABASE_MUST_BE_LOCAL");
	if (target.isAuthoritative) {
		if (!localLinkedInExecutorEnabled(options.env))
			throw new Error("AUTHORITATIVE_CRM_EXECUTION_DISABLED");
		return target;
	}
	if (options.worker)
		throw new Error("PERSISTENT_WORKER_REQUIRES_AUTHORITATIVE_CRM");
	if (!options.allowDisposableDatabase)
		throw new Error("RUN_ONCE_REQUIRES_ALLOW_DISPOSABLE_DB");
	return target;
}
