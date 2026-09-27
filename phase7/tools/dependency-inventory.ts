import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolDirectory = fileURLToPath(new URL(".", import.meta.url));
const bunRoot = resolve(toolDirectory, "../../node_modules/.bun");
const output = resolve(toolDirectory, "../evidence/dependency-inventory.json");
const packages = new Map<
	string,
	{ name: string; version: string; license: string }
>();

const licenseFromFile = async (packageJsonPath: string) => {
	const directory = dirname(packageJsonPath);
	const entries = await readdir(directory).catch(() => []);
	const candidate = entries.find((entry) =>
		/^(licen[cs]e|copying)(\.|$)/i.test(entry),
	);
	if (!candidate) return "UNKNOWN";
	const content = await readFile(resolve(directory, candidate), "utf8").catch(
		() => "",
	);
	if (/MIT License/i.test(content)) return "MIT";
	if (/Apache License.*Version 2\.0/is.test(content)) return "Apache-2.0";
	if (/BSD 3-Clause/i.test(content)) return "BSD-3-Clause";
	return "UNKNOWN";
};

const candidates = await readdir(bunRoot, { withFileTypes: true });
for (const candidate of candidates) {
	if (!candidate.isDirectory()) continue;
	const modules = resolve(bunRoot, candidate.name, "node_modules");
	let entries: string[];
	try {
		entries = await readdir(modules);
	} catch {
		continue;
	}
	for (const entry of entries) {
		const paths = entry.startsWith("@")
			? (await readdir(resolve(modules, entry)).catch(() => [])).map((child) =>
					resolve(modules, entry, child, "package.json"),
				)
			: [resolve(modules, entry, "package.json")];
		for (const path of paths) {
			try {
				const metadata = JSON.parse(await readFile(path, "utf8")) as {
					name?: string;
					version?: string;
					license?: string | { type?: string };
					licenses?: Array<{ type?: string }>;
				};
				if (!metadata.name || !metadata.version) continue;
				let license =
					typeof metadata.license === "string"
						? metadata.license
						: (metadata.license?.type ??
							metadata.licenses
								?.map((item) => item.type)
								.filter(Boolean)
								.join(" OR ") ??
							"UNKNOWN");
				if (license === "UNKNOWN") license = await licenseFromFile(path);
				packages.set(`${metadata.name}@${metadata.version}`, {
					name: metadata.name,
					version: metadata.version,
					license,
				});
			} catch {
				// Broken optional package metadata is recorded by absence, not guessed.
			}
		}
	}
}

const dependencies = [...packages.values()].sort(
	(left, right) =>
		left.name.localeCompare(right.name) ||
		left.version.localeCompare(right.version),
);
const byLicense: Record<string, number> = {};
for (const dependency of dependencies) {
	const licenseKey = dependency.license.toUpperCase();
	byLicense[licenseKey] = (byLicense[licenseKey] ?? 0) + 1;
}
const unknownLicenses = dependencies
	.filter((dependency) => dependency.license === "UNKNOWN")
	.map(({ name, version }) => ({ name, version }));
const document = {
	formatVersion: 1,
	generatedAt: new Date().toISOString(),
	packageManager: "bun@1.3.12",
	dependencyCount: dependencies.length,
	byLicense,
	unknownLicenses,
	dependencies,
};
const serialized = `${JSON.stringify(document, null, 2)}\n`;
await writeFile(output, serialized);
console.log(
	JSON.stringify(
		{
			dependencyCount: dependencies.length,
			unknownLicenses: unknownLicenses.length,
			checksum: createHash("sha256").update(serialized).digest("hex"),
		},
		null,
		2,
	),
);
