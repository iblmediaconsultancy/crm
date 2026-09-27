import { describe, expect, it } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { createRateLimitMiddleware } from "../src/security/rate-limit.middleware";

const response = () => {
	const headers = new Map<string, string>();
	let status = 200;
	let body: unknown;
	const value = {
		setHeader: (name: string, content: string) => headers.set(name, content),
		status: (next: number) => {
			status = next;
			return value;
		},
		json: (next: unknown) => {
			body = next;
			return value;
		},
	};
	return {
		value: value as unknown as Response,
		headers,
		read: () => ({ status, body }),
	};
};

describe("API rate limit", () => {
	it("fails with 429 after the configured budget and resets", () => {
		let time = 1_000;
		const middleware = createRateLimitMiddleware({
			max: 2,
			windowMs: 1_000,
			now: () => time,
		});
		const request = { path: "/trpc", ip: "127.0.0.1", socket: {} } as Request;
		let nextCalls = 0;
		const next = (() => {
			nextCalls += 1;
		}) as NextFunction;
		middleware(request, response().value, next);
		middleware(request, response().value, next);
		const blocked = response();
		middleware(request, blocked.value, next);
		expect(blocked.read().status).toBe(429);
		expect(nextCalls).toBe(2);
		time = 2_001;
		middleware(request, response().value, next);
		expect(nextCalls).toBe(3);
	});

	it("never blocks liveness or readiness probes", () => {
		const middleware = createRateLimitMiddleware({ max: 1, windowMs: 1_000 });
		let calls = 0;
		const next = (() => {
			calls += 1;
		}) as NextFunction;
		for (let index = 0; index < 3; index += 1) {
			middleware({ path: "/health/ready" } as Request, response().value, next);
		}
		expect(calls).toBe(3);
	});
});
