import { existsSync } from "node:fs";
import { join } from "node:path";

export function resolveEveExecutable(
	platform: NodeJS.Platform = process.platform,
	directories: string[] = [join(process.cwd(), "node_modules", ".bin")],
	fileExists: (path: string) => boolean = existsSync,
): string {
	const names = platform === "win32" ? ["eve.exe", "eve.cmd", "eve"] : ["eve"];
	for (const directory of directories) {
		for (const name of names) {
			const candidate = join(directory, name);
			if (fileExists(candidate)) return candidate;
		}
	}
	return names[0] ?? "eve";
}
