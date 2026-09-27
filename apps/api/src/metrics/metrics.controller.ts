import { timingSafeEqual } from "node:crypto";
import type { Db } from "@crm/db";
import { Controller, Get, Headers, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { Response } from "express";
import type { EnvironmentVariables } from "../config/env.validation";
import { InjectDatabase } from "../database/database.constants";

@Controller("internal/metrics")
export class MetricsController {
	private readonly secret: string | undefined;

	constructor(
		@InjectDatabase() private readonly db: Db,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get()
	@AllowAnonymous()
	async metrics(
		@Headers("authorization") authorization: string | undefined,
		@Res() response: Response,
	) {
		if (!this.authorized(authorization)) {
			return response.status(403).type("text/plain").send("forbidden\n");
		}
		let databaseUp = 1;
		try {
			await this.db.$queryRaw`SELECT 1`;
		} catch {
			databaseUp = 0;
		}
		const memory = process.memoryUsage();
		const body = [
			"# HELP ibl_api_up API process liveness.",
			"# TYPE ibl_api_up gauge",
			"ibl_api_up 1",
			"# HELP ibl_database_up Database readiness from the API runtime identity.",
			"# TYPE ibl_database_up gauge",
			`ibl_database_up ${databaseUp}`,
			"# HELP ibl_process_uptime_seconds API process uptime.",
			"# TYPE ibl_process_uptime_seconds gauge",
			`ibl_process_uptime_seconds ${process.uptime()}`,
			"# HELP ibl_process_resident_memory_bytes API resident memory.",
			"# TYPE ibl_process_resident_memory_bytes gauge",
			`ibl_process_resident_memory_bytes ${memory.rss}`,
			"",
		].join("\n");
		return response.type("text/plain; version=0.0.4").send(body);
	}

	private authorized(authorization: string | undefined) {
		if (!this.secret) return false;
		const actual = Buffer.from(authorization ?? "");
		const expected = Buffer.from(`Bearer ${this.secret}`);
		return (
			actual.length === expected.length && timingSafeEqual(actual, expected)
		);
	}
}
