import { CacheModule } from "@nestjs/cache-manager";
import { Module } from "@nestjs/common";

const DEFAULT_TTL_MS = 60_000;

@Module({
	imports: [
		CacheModule.register({
			isGlobal: true,
			ttl: DEFAULT_TTL_MS,
			max: 1_000,
		}),
	],
	exports: [CacheModule],
})
export class AppCacheModule {}
