param(
	[ValidateSet("node-turbopack", "bun-turbopack", "bun-webpack")]
	[string]$Mode = "node-turbopack",
	[int]$Runs = 2
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$synthetic = @(
	"-e", "DATABASE_URL=postgresql://phase0:phase0@127.0.0.1:1/phase0",
	"-e", "BETTER_AUTH_SECRET=phase0-build-only-secret-not-production",
	"-e", "APP_URL=http://localhost:3000",
	"-e", "API_URL=http://localhost:3001",
	"-e", "NEXT_TELEMETRY_DISABLED=1"
)

$shape = switch ($Mode) {
	"node-turbopack" { @("node:24.18.0-bookworm", "node /workspace/apps/app/node_modules/next/dist/bin/next build") }
	"bun-turbopack" { @("oven/bun:1.3.12", "bunx next build") }
	"bun-webpack" { @("oven/bun:1.3.12", "bunx next build --webpack") }
}

for ($run = 1; $run -le $Runs; $run += 1) {
	if (Test-Path (Join-Path $repo "apps\app\.next")) {
		Remove-Item -LiteralPath (Join-Path $repo "apps\app\.next") -Recurse -Force
	}
	Write-Host "Phase 0 build matrix: mode=$Mode run=$run/$Runs image=$($shape[0])"
	& docker run --rm @synthetic -v "${repo}:/workspace" -w /workspace/apps/app $shape[0] sh -lc $shape[1]
	if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

& docker image inspect $shape[0] --format '{{json .RepoDigests}}'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
