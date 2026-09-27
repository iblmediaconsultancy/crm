import { spawn } from "node:child_process";
import { constants } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEveExecutable } from "../agent/lib/eve-launcher";
import { isScheduledExecutionEnabled } from "../agent/lib/scheduled-execution";

const rawPort = process.env.AGENT_PORT ?? process.env.PORT ?? "2000";
const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error(
		`AGENT_PORT or PORT must be a valid port, received ${rawPort}.`,
	);
}

const cli = resolveEveExecutable(process.platform, [
	join(process.cwd(), "node_modules", ".bin"),
	fileURLToPath(new URL("../node_modules/.bin/", import.meta.url)),
]);
console.log(
	`[agent] scheduled execution ${isScheduledExecutionEnabled() ? "ENABLED" : "DISABLED"}`,
);
console.log(`[agent] eve executable ${cli}`);
const usesCommandShim = cli.toLowerCase().endsWith(".cmd");
const child = spawn(cli, ["start", "--port", String(port)], {
	stdio: "inherit",
	env: process.env,
	shell: usesCommandShim,
});

let settled = false;

const finish = (code: number) => {
	if (settled) return;
	settled = true;
	process.exitCode = code;
};

const forward = (signal: NodeJS.Signals) => {
	if (!child.killed) child.kill(signal);
};

process.once("SIGINT", forward);
process.once("SIGTERM", forward);

child.once("exit", (code, signal) => {
	const signalNumber = signal ? constants.signals[signal] : null;
	finish(code ?? (signalNumber ? 128 + signalNumber : 1));
});

child.once("error", (error) => {
	console.error(`[agent] could not start eve: ${error.message}`);
	finish(1);
});
