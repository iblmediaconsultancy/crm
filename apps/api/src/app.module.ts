import { auth } from "@crm/auth";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule as BetterAuthModule } from "@thallesp/nestjs-better-auth";
import { ActivitiesModule } from "./activities/activities.module";
import { AgentModule } from "./agent/agent.module";
import { AuthModule } from "./auth/auth.module";
import { BackfillModule } from "./backfill/backfill.module";
import { AppCacheModule } from "./cache/cache.module";
import { CompaniesModule } from "./companies/companies.module";
import { validateEnv } from "./config/env.validation";
import { ContactsModule } from "./contacts/contacts.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { CrmModule } from "./crm/crm.module";
import { CurrencyModule } from "./currency/currency.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DatabaseModule } from "./database/database.module";
import { DealsModule } from "./deals/deals.module";
import { FieldsModule } from "./fields/fields.module";
import { FinanceModule } from "./finance/finance.module";
import { HealthModule } from "./health/health.module";
import { LinkedInModule } from "./linkedin/linkedin.module";
import { LoggingModule } from "./logging/logging.module";
import { logAuthRoute } from "./logging/request-logger.middleware";
import { MailboxModule } from "./mailbox/mailbox.module";
import { MeetingsModule } from "./meetings/meetings.module";
import { MetricsModule } from "./metrics/metrics.module";
import { OnboardingModule } from "./onboarding/onboarding.module";
import { OperationsModule } from "./operations/operations.module";
import { ProfileModule } from "./profile/profile.module";
import { ProviderCapabilitiesModule } from "./provider-capabilities/provider-capabilities.module";
import { ProvidersModule } from "./providers/providers.module";
import { SearchModule } from "./search/search.module";
import { SettingsModule } from "./settings/settings.module";
import { SsoModule } from "./sso/sso.module";
import { TrpcModule } from "./trpc/trpc.module";
import { UsersModule } from "./users/users.module";
import { WorkspaceModule } from "./workspace/workspace.module";

@Module({
	imports: [
		LoggingModule,
		ConfigModule.forRoot({
			isGlobal: true,
			cache: true,
			validate: validateEnv,
		}),
		AppCacheModule,
		DatabaseModule,
		CrmModule,
		BetterAuthModule.forRoot({ auth, middleware: logAuthRoute }),
		AuthModule,
		HealthModule,
		TrpcModule,
		UsersModule,
		CompaniesModule,
		ContactsModule,
		ConversationsModule,
		CurrencyModule,
		DealsModule,
		FieldsModule,
		FinanceModule,
		ProfileModule,
		ProviderCapabilitiesModule,
		ProvidersModule,
		ActivitiesModule,
		AgentModule,
		DashboardModule,
		SearchModule,
		MailboxModule,
		MetricsModule,
		MeetingsModule,
		LinkedInModule,
		OnboardingModule,
		OperationsModule,
		SettingsModule,
		SsoModule,
		WorkspaceModule,
		BackfillModule,
	],
})
export class AppModule {}
