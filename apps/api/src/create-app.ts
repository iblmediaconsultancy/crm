import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
	ExpressAdapter,
	type NestExpressApplication,
} from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { ContextLogger } from "./logging/context-logger";
import { createRateLimitMiddleware } from "./security/rate-limit.middleware";

export async function createApp(): Promise<NestExpressApplication> {
	const app = await NestFactory.create<NestExpressApplication>(
		AppModule,
		new ExpressAdapter(),
		{ bodyParser: false, logger: new ContextLogger() },
	);

	app.use(helmet());
	app.enableCors({
		origin: (process.env.APP_URL ?? "http://localhost:3000")
			.split(",")
			.map((origin) => origin.trim()),
		credentials: true,
		methods: ["GET", "POST", "OPTIONS"],
	});
	app.use(
		createRateLimitMiddleware({
			windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS ?? 60_000),
			max: Number(process.env.API_RATE_LIMIT_MAX ?? 300),
		}),
	);
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
			transformOptions: { enableImplicitConversion: true },
		}),
	);

	return app;
}
