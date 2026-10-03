import type { auth } from "@crm/auth";
import { Controller, Get, Param, Res, StreamableFile } from "@nestjs/common";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import type { Response } from "express";
import { AttachmentStorageService } from "./attachment-storage.service";

type CrmSession = UserSession<typeof auth>;
@Controller("api/mailbox/attachments")
export class MessageAttachmentController {
	constructor(private readonly attachments: AttachmentStorageService) {}
	@Get(":id")
	async read(
		@Param("id") id: string,
		@Session() session: CrmSession,
		@Res({ passthrough: true }) response: Response,
	) {
		const row = await this.attachments.download(id, session.user.id);
		response.setHeader("Cache-Control", "private, no-store");
		response.setHeader("Content-Length", row.content.byteLength.toString());
		response.setHeader(
			"Content-Type",
			row.disposition === "inline" ? row.mediaType : "application/octet-stream",
		);
		response.setHeader(
			"Content-Disposition",
			`${row.disposition === "inline" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
		);
		response.setHeader("X-Content-Type-Options", "nosniff");
		response.setHeader(
			"Content-Security-Policy",
			"sandbox; default-src 'none'",
		);
		return new StreamableFile(row.content);
	}
}
