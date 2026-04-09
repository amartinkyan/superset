/**
 * Builds a standalone Superset CLI distribution tarball.
 *
 * Bundle layout (extracts into ~/superset/):
 *   bin/superset         — Bun-compiled CLI binary
 *   bin/superset-host    — Shell wrapper to run the host-service
 *   lib/node             — Standalone Node.js runtime
 *   lib/host-service.js  — Bundled host-service entry
 *   lib/native/          — Native addons (.node files)
 *   share/migrations/    — Drizzle migration SQL files
 *
 * Usage:
 *   bun run scripts/build-dist.ts --target=darwin-arm64
 *   bun run scripts/build-dist.ts --target=darwin-x64
 *   bun run scripts/build-dist.ts --target=linux-x64
 */
import { spawn } from "node:child_process";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

type Target = "darwin-arm64" | "darwin-x64" | "linux-x64";

const VALID_TARGETS: Target[] = ["darwin-arm64", "darwin-x64", "linux-x64"];
const NODE_VERSION = "22.13.0";

function parseArgs(): { target: Target } {
	const targetArg = process.argv.find((a) => a.startsWith("--target="));
	if (!targetArg) {
		console.error("Missing required --target=<platform-arch>");
		console.error(`Valid targets: ${VALID_TARGETS.join(", ")}`);
		process.exit(1);
	}
	const target = targetArg.slice("--target=".length) as Target;
	if (!VALID_TARGETS.includes(target)) {
		console.error(`Invalid target: ${target}`);
		console.error(`Valid targets: ${VALID_TARGETS.join(", ")}`);
		process.exit(1);
	}
	return { target };
}

function nodeArchiveName(target: Target): string {
	// nodejs.org naming convention
	const arch = target === "darwin-arm64" ? "arm64" : "x64";
	const platform = target.startsWith("darwin") ? "darwin" : "linux";
	return `node-v${NODE_VERSION}-${platform}-${arch}`;
}

function nodeDownloadUrl(target: Target): string {
	return `https://nodejs.org/dist/v${NODE_VERSION}/${nodeArchiveName(target)}.tar.gz`;
}

async function exec(cmd: string, args: string[], cwd?: string): Promise<void> {
	return new Promise((res, rej) => {
		const child = spawn(cmd, args, {
			cwd,
			stdio: "inherit",
		});
		child.on("exit", (code) => {
			if (code === 0) res();
			else rej(new Error(`${cmd} ${args.join(" ")} exited with ${code}`));
		});
		child.on("error", rej);
	});
}

async function downloadAndExtractNode(
	target: Target,
	destDir: string,
): Promise<string> {
	const cacheDir = join(homedir(), ".superset-build-cache");
	if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

	const archiveName = nodeArchiveName(target);
	const archivePath = join(cacheDir, `${archiveName}.tar.gz`);
	const extractedPath = join(cacheDir, archiveName);

	if (!existsSync(archivePath)) {
		console.log(`[build-dist] downloading ${nodeDownloadUrl(target)}`);
		await exec("curl", ["-fsSL", "-o", archivePath, nodeDownloadUrl(target)]);
	}

	if (!existsSync(extractedPath)) {
		console.log(`[build-dist] extracting Node.js for ${target}`);
		await exec("tar", ["-xzf", archivePath, "-C", cacheDir]);
	}

	const sourceBinary = join(extractedPath, "bin", "node");
	const destBinary = join(destDir, "node");
	cpSync(sourceBinary, destBinary);
	chmodSync(destBinary, 0o755);
	return destBinary;
}

function findFirstExisting(paths: string[]): string | null {
	for (const p of paths) {
		if (existsSync(p)) return p;
	}
	return null;
}

function copyNativeAddons(target: Target, destDir: string): void {
	const repoRoot = resolve(import.meta.dir, "../../..");
	const bunPackages = join(repoRoot, "node_modules", ".bun");

	// better-sqlite3 — bun builds from source into build/Release/
	const sqliteBuildRoot = join(
		bunPackages,
		"better-sqlite3@12.6.2",
		"node_modules",
		"better-sqlite3",
	);
	const sqliteNode = findFirstExisting([
		join(sqliteBuildRoot, "prebuilds", target, "better-sqlite3.node"),
		join(sqliteBuildRoot, "build", "Release", "better_sqlite3.node"),
	]);
	if (!sqliteNode) {
		throw new Error(
			`better-sqlite3 native binary not found for ${target}. Run 'bun install' first.`,
		);
	}
	cpSync(sqliteNode, join(destDir, "better_sqlite3.node"));

	// node-pty — prebuild or build/Release/
	const ptyRoot = join(
		bunPackages,
		"node-pty@1.1.0",
		"node_modules",
		"node-pty",
	);
	const ptyNode = findFirstExisting([
		join(ptyRoot, "prebuilds", target, "pty.node"),
		join(ptyRoot, "build", "Release", "pty.node"),
	]);
	if (!ptyNode) {
		throw new Error(
			`node-pty native binary not found for ${target}. Run 'bun install' first.`,
		);
	}
	cpSync(ptyNode, join(destDir, "pty.node"));

	if (target.startsWith("darwin")) {
		const spawnHelper = findFirstExisting([
			join(ptyRoot, "prebuilds", target, "spawn-helper"),
			join(ptyRoot, "build", "Release", "spawn-helper"),
		]);
		if (spawnHelper) {
			cpSync(spawnHelper, join(destDir, "spawn-helper"));
			chmodSync(join(destDir, "spawn-helper"), 0o755);
		}
	}

	// @parcel/watcher — has per-platform packages under bun's .bun/ dir
	const parcelWatcherRoot = join(
		bunPackages,
		`@parcel+watcher-${target}@2.5.6`,
		"node_modules",
		"@parcel",
		`watcher-${target}`,
	);
	const watcherNode = findFirstExisting([
		join(parcelWatcherRoot, "watcher.node"),
	]);
	if (watcherNode) {
		cpSync(watcherNode, join(destDir, "watcher.node"));
	} else {
		console.warn(
			`[build-dist] warning: @parcel/watcher-${target} not found, filesystem watching may not work`,
		);
	}
}

async function buildCli(target: Target, outputPath: string): Promise<void> {
	const relayUrl = process.env.RELAY_URL || "https://relay.superset.sh";
	const cloudApiUrl = process.env.CLOUD_API_URL || "https://api.superset.sh";

	const cliDir = resolve(import.meta.dir, "..");
	await exec(
		"bun",
		[
			"build",
			"--compile",
			`--target=bun-${target}`,
			"--define",
			`process.env.RELAY_URL="${relayUrl}"`,
			"--define",
			`process.env.CLOUD_API_URL="${cloudApiUrl}"`,
			"src/bin.ts",
			"--outfile",
			outputPath,
		],
		cliDir,
	);
}

async function buildHostService(): Promise<string> {
	const hostServiceDir = resolve(import.meta.dir, "../../host-service");
	await exec("bun", ["run", "build:host"], hostServiceDir);
	return join(hostServiceDir, "dist", "host-service.js");
}

function writeHostWrapper(binDir: string): void {
	const wrapper = `#!/bin/sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export NODE_PATH="$SCRIPT_DIR/../lib/native"
exec "$SCRIPT_DIR/../lib/node" "$SCRIPT_DIR/../lib/host-service.js" "$@"
`;
	const wrapperPath = join(binDir, "superset-host");
	writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
	chmodSync(wrapperPath, 0o755);
}

async function main(): Promise<void> {
	const { target } = parseArgs();
	const cliDir = resolve(import.meta.dir, "..");
	const stagingRoot = join(cliDir, "dist", `superset-${target}`);

	// Clean previous staging
	if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true });
	mkdirSync(join(stagingRoot, "bin"), { recursive: true });
	mkdirSync(join(stagingRoot, "lib", "native"), { recursive: true });
	mkdirSync(join(stagingRoot, "share"), { recursive: true });

	console.log(`[build-dist] target: ${target}`);
	console.log(`[build-dist] staging: ${stagingRoot}`);

	// 1. Build CLI binary
	console.log("[build-dist] building CLI binary");
	await buildCli(target, join(stagingRoot, "bin", "superset"));

	// 2. Build host-service bundle
	console.log("[build-dist] building host-service bundle");
	const hostServiceBundle = await buildHostService();
	cpSync(hostServiceBundle, join(stagingRoot, "lib", "host-service.js"));

	// 3. Download Node.js
	console.log("[build-dist] fetching Node.js");
	await downloadAndExtractNode(target, join(stagingRoot, "lib"));

	// 4. Copy native addons
	console.log("[build-dist] copying native addons");
	copyNativeAddons(target, join(stagingRoot, "lib", "native"));

	// 5. Copy migrations
	console.log("[build-dist] copying migrations");
	const migrationsSrc = resolve(import.meta.dir, "../../host-service/drizzle");
	cpSync(migrationsSrc, join(stagingRoot, "share", "migrations"), {
		recursive: true,
	});

	// 6. Write host wrapper
	console.log("[build-dist] writing host wrapper");
	writeHostWrapper(join(stagingRoot, "bin"));

	// 7. Tar
	const tarball = join(cliDir, "dist", `superset-${target}.tar.gz`);
	console.log(`[build-dist] creating ${tarball}`);
	await exec("tar", [
		"-czf",
		tarball,
		"-C",
		dirname(stagingRoot),
		`superset-${target}`,
	]);

	console.log(`[build-dist] done: ${tarball}`);
}

await main();
