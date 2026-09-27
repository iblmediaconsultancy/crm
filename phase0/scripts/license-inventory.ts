type PackageManifest = {
	name?: string;
	version?: string;
	license?: string;
	licenses?: Array<{ type?: string }>;
	dependencies?: Record<string, string>;
	private?: boolean;
};

const permissive = new Set([
	"MIT",
	"APACHE-2.0",
	"BSD-2-CLAUSE",
	"BSD-3-CLAUSE",
	"ISC",
	"0BSD",
	"CC0-1.0",
	"PYTHON-2.0",
]);
const workspacePackages = new Map<string, PackageManifest>();

const roots = ["package.json"];
for (const parent of ["apps", "packages"]) {
	const glob = new Bun.Glob(`${parent}/*/package.json`);
	for await (const path of glob.scan({ cwd: process.cwd() })) roots.push(path);
}

const dependencies = new Map<string, Set<string>>();
for (const manifestPath of roots) {
	const manifest = (await Bun.file(manifestPath).json()) as PackageManifest;
	if (manifest.name) workspacePackages.set(manifest.name, manifest);
	for (const name of Object.keys(manifest.dependencies ?? {})) {
		const consumers = dependencies.get(name) ?? new Set<string>();
		consumers.add(manifest.name ?? manifestPath);
		dependencies.set(name, consumers);
	}
}

const installed = new Map<string, PackageManifest>();
for (const pattern of [
	"node_modules/.bun/*/node_modules/*/package.json",
	"node_modules/.bun/*/node_modules/@*/*/package.json",
	"apps/*/package.json",
	"packages/*/package.json",
]) {
	const glob = new Bun.Glob(pattern);
	for await (const path of glob.scan({ cwd: process.cwd(), dot: true })) {
		const manifest = (await Bun.file(path).json()) as PackageManifest;
		if (manifest.name && !installed.has(manifest.name))
			installed.set(manifest.name, manifest);
	}
}

const inventory = [];
for (const [name, consumers] of [...dependencies].sort(([left], [right]) =>
	left.localeCompare(right),
)) {
	const manifest = installed.get(name);
	if (manifest) {
		const workspace = workspacePackages.get(name);
		const inherited = Boolean(
			workspace?.private && name.startsWith("@crm/") && !manifest.license,
		);
		const license = inherited
			? "MIT"
			: (manifest.license ??
				manifest.licenses
					?.map((item) => item.type)
					.filter(Boolean)
					.join(" OR ") ??
				"MISSING");
		const identifiers = license
			.replace(/[()]/g, " ")
			.split(/\s+(?:AND|OR)\s+/i)
			.map((item) => item.trim().toUpperCase())
			.filter(Boolean);
		inventory.push({
			name,
			version: manifest.version ?? "workspace",
			license,
			licenseSource: inherited
				? "inherited from repository root LICENSE"
				: "installed package metadata",
			firstPartyWorkspace: inherited,
			consumers: [...consumers].sort(),
			legalReview:
				identifiers.length === 0 ||
				!identifiers.every((item) => permissive.has(item)),
			obligations: inherited
				? [
						"retain Comp AI 2026 copyright and MIT permission notice in copies or substantial portions",
					]
				: undefined,
		});
	} else {
		inventory.push({
			name,
			version: "UNRESOLVED",
			license: "MISSING",
			consumers: [...consumers].sort(),
			legalReview: true,
			error: "installed package metadata not found",
		});
	}
}

const output = {
	generatedAt: new Date().toISOString(),
	root: { name: "crm", version: "1.4.0", license: "MIT" },
	eve: {
		version: "0.29.4",
		license: "Apache-2.0",
		noticeRequired: true,
		notice:
			"Copyright 2026 Vercel, Inc. and contributors; includes software developed at Vercel, Inc.",
		preview: true,
	},
	directRuntimeDependencies: inventory,
};

const destination = process.argv[2];
if (destination) {
	await Bun.write(destination, `${JSON.stringify(output, null, 2)}\n`);
	console.log(
		JSON.stringify({
			written: destination,
			dependencies: inventory.length,
			legalReview: inventory.filter((item) => item.legalReview).length,
		}),
	);
} else {
	console.log(JSON.stringify(output, null, 2));
}
