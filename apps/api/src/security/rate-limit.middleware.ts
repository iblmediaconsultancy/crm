import type { NextFunction, Request, Response } from "express";

interface Bucket {
	count: number;
	resetAt: number;
}

export interface RateLimitOptions {
	windowMs: number;
	max: number;
	now?: () => number;
}

export const createRateLimitMiddleware = ({
	windowMs,
	max,
	now = Date.now,
}: RateLimitOptions) => {
	if (!Number.isFinite(windowMs) || windowMs < 1_000) {
		throw new Error("API rate-limit window must be at least one second");
	}
	if (!Number.isFinite(max) || max < 1) {
		throw new Error("API rate-limit maximum must be positive");
	}
	const buckets = new Map<string, Bucket>();

	return (request: Request, response: Response, next: NextFunction) => {
		if (request.path.startsWith("/health/")) return next();
		const timestamp = now();
		const key = request.ip || request.socket.remoteAddress || "unknown";
		const current = buckets.get(key);
		const bucket =
			!current || current.resetAt <= timestamp
				? { count: 0, resetAt: timestamp + windowMs }
				: current;
		bucket.count += 1;
		buckets.set(key, bucket);

		response.setHeader("RateLimit-Limit", String(max));
		response.setHeader(
			"RateLimit-Remaining",
			String(Math.max(0, max - bucket.count)),
		);
		response.setHeader(
			"RateLimit-Reset",
			String(Math.ceil(bucket.resetAt / 1_000)),
		);
		if (bucket.count > max) {
			response.setHeader(
				"Retry-After",
				String(Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1_000))),
			);
			return response.status(429).json({
				statusCode: 429,
				message: "Too many requests",
			});
		}
		return next();
	};
};
