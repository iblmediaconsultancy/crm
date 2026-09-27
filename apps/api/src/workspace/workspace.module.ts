import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { TrpcModule } from "../trpc/trpc.module";
import { MembershipSecurityService } from "./membership-security.service";
import { WorkspaceRouter } from "./workspace.router";
import { WorkspaceService } from "./workspace.service";

@Module({
	imports: [AgentModule, TrpcModule],
	providers: [MembershipSecurityService, WorkspaceService, WorkspaceRouter],
	exports: [MembershipSecurityService, WorkspaceService],
})
export class WorkspaceModule {}
