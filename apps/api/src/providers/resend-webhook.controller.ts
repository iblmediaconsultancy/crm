import { Controller, Headers, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { OutreachLifecycleService } from "./outreach-lifecycle.service";

@Controller("webhooks/resend")
export class ResendWebhookController {
	constructor(private readonly outreach: OutreachLifecycleService) {}

	@Post()
	@HttpCode(202)
	async receive(
		@Req() request: Request,
		@Headers() sourceHeaders: Record<string, string | string[] | undefined>,
	) {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of request) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += buffer.length;
			if (size > 1_048_576) throw new Error("RESEND_WEBHOOK_TOO_LARGE");
			chunks.push(buffer);
		}
		const headers = Object.fromEntries(
			Object.entries(sourceHeaders).flatMap(([key, value]) =>
				typeof value === "string" ? [[key.toLowerCase(), value]] : [],
			),
		);
		return this.outreach.verifyAndApplyResend(
			Buffer.concat(chunks).toString("utf8"),
			headers,
		);
	}
}
