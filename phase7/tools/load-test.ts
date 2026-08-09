const baseUrl = process.env.LOAD_TEST_BASE_URL ?? "http://127.0.0.1:3301";
const requests = Number(process.env.LOAD_TEST_REQUESTS ?? 500);
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? 25);
if (
	!Number.isInteger(requests) ||
	requests < 1 ||
	!Number.isInteger(concurrency) ||
	concurrency < 1
)
	throw new Error(
		"Load-test request and concurrency values must be positive integers",
	);

const latencies: number[] = [];
let failures = 0;
let nextIndex = 0;
const run = async () => {
	while (nextIndex < requests) {
		nextIndex += 1;
		const startedAt = performance.now();
		try {
			const response = await fetch(`${baseUrl}/health/ready`, {
				signal: AbortSignal.timeout(5_000),
			});
			if (!response.ok) failures += 1;
			await response.arrayBuffer();
		} catch {
			failures += 1;
		}
		latencies.push(performance.now() - startedAt);
	}
};
const startedAt = performance.now();
await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, run));
const durationMs = performance.now() - startedAt;
latencies.sort((left, right) => left - right);
const percentile = (value: number) =>
	latencies[
		Math.min(latencies.length - 1, Math.floor(latencies.length * value))
	] ?? 0;
const report = {
	requests,
	concurrency,
	failures,
	durationMs: Number(durationMs.toFixed(1)),
	requestsPerSecond: Number((requests / (durationMs / 1_000)).toFixed(1)),
	latencyMs: {
		p50: Number(percentile(0.5).toFixed(1)),
		p95: Number(percentile(0.95).toFixed(1)),
		p99: Number(percentile(0.99).toFixed(1)),
		max: Number((latencies.at(-1) ?? 0).toFixed(1)),
	},
};
console.log(JSON.stringify(report, null, 2));
if (failures > 0 || report.latencyMs.p95 > 500) process.exitCode = 1;
