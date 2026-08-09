import type { Db, Prisma } from "@crm/db";
import { Injectable } from "@nestjs/common";
import type { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import type { updateOwnProfileInput } from "./profile.contracts";

export interface ProfileView {
	userId: string;
	status: "ACTIVE" | "SUSPENDED";
	preferredLanguage: string;
	locale: string;
	timeZone: string;
	workingPreferences: unknown;
	activatedAt: Date | null;
	suspendedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

@Injectable()
export class ProfileService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	get(userId: string): Promise<ProfileView> {
		return this.db.userProfile.findUniqueOrThrow({ where: { userId } });
	}

	updateOwn(
		userId: string,
		input: z.infer<typeof updateOwnProfileInput>,
	): Promise<ProfileView> {
		return this.db.userProfile.update({
			where: { userId },
			data: {
				...input,
				workingPreferences: input.workingPreferences as Prisma.InputJsonValue,
			},
		});
	}
}
