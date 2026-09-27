import { spawn } from "node:child_process";
import { resolve } from "node:path";

const command = resolve(
	import.meta.dir,
	"..",
	"node_modules",
	".bin",
	process.platform === "win32" ? "nestjs-trpc.exe" : "nestjs-trpc",
);
const child = spawn(
	command,
	[
		"watch",
		"-e",
		"src/app.module.ts",
		"-r",
		"**/*.router.ts",
		"-o",
		"src/generated",
	],
	{ stdio: "inherit" },
);

child.on("error", (error) => {
	console.error(error.message);
	process.exitCode = 1;
});

child.on("exit", (code) => {
	process.exitCode = code ?? 1;
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
