import type { Session, SessionUser, WorkspaceRole } from "@crm/auth";
import type { Request } from "express";

export type BaseTrpcContext = {
	req?: Request;
	session: Session | null;
};

export type AuthedTrpcContext = BaseTrpcContext & {
	user: SessionUser;
	workspaceRole: WorkspaceRole;
};
