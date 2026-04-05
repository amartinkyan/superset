/**
 * Clean shell environment resolution for v2 terminals.
 *
 * Spawns the user's login shell with a minimal parent env so that
 * desktop runtime state (Vite .env secrets, Electron vars, build-tool
 * config) never contaminates the shell snapshot. The shell's profile
 * scripts populate the env with the user's actual vars.
 *
 * This makes dev and production behave identically — the snapshot only
 * contains what the user's shell profile produces.
 *
 * Design reference:
 * - VS Code (src/vs/platform/shell/node/shellEnv.ts): spawns a login
 *   shell with detached:true, captures JSON env via Node inside the
 *   shell, cleans up ELECTRON_* vars from the result.
 * - shell-env (npm): spawns a login shell with `command env` between
 *   delimiters, parses line-based output.
 *
 * We combine the best of both:
 * - Clean parent env (neither VS Code nor shell-env do this)
 * - Delimiter-wrapped `command env` (from shell-env — no Node dependency)
 * - Detached spawn + stderr capture (from VS Code — resilience + debuggability)
 */
import { type ChildProcess, spawn } from "node:child_process";
import { augmentPathForMacOS } from "./shell-env";

const SHELL_ENV_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 60_000;

/**
 * Minimal env keys needed to bootstrap a login shell.
 * Matches what macOS gives a packaged Electron app.
 */
const SHELL_BOOTSTRAP_KEYS = [
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"PATH",
	"TERM",
	"TMPDIR",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	// macOS specific
	"__CF_USER_TEXT_ENCODING",
	"Apple_PubSub_Socket_Render",
	// Windows (for future cross-platform support)
	"COMSPEC",
	"USERPROFILE",
	"SYSTEMROOT",
];

const DELIMITER = "__SUPERSET_SHELL_ENV__";

function buildMinimalEnv(): Record<string, string> {
	const env: Record<string, string> = {
		// Prevent oh-my-zsh and tmux plugin from blocking
		DISABLE_AUTO_UPDATE: "true",
		ZSH_TMUX_AUTOSTARTED: "true",
		ZSH_TMUX_AUTOSTART: "false",
	};

	for (const key of SHELL_BOOTSTRAP_KEYS) {
		const value = process.env[key];
		if (value) env[key] = value;
	}

	// Ensure common macOS paths are in PATH so the shell and profile
	// scripts can find Homebrew and other user-installed tools
	augmentPathForMacOS(env);

	return env;
}

function parseEnvOutput(stdout: string): Record<string, string> {
	const sections = stdout.split(DELIMITER);
	const envSection = sections[1];
	if (!envSection) {
		throw new Error(
			"Failed to parse shell environment output — delimiter not found",
		);
	}

	const result: Record<string, string> = {};
	for (const line of envSection.split("\n").filter(Boolean)) {
		const idx = line.indexOf("=");
		if (idx > 0) {
			result[line.slice(0, idx)] = line.slice(idx + 1);
		}
	}

	if (Object.keys(result).length === 0) {
		throw new Error(
			"Shell environment resolution returned empty env — shell may have failed to start",
		);
	}

	return result;
}

/**
 * Spawn a login shell with a minimal parent env and capture the resulting
 * environment.
 *
 * Uses detached:true (VS Code pattern) so the shell survives if the parent
 * receives a signal during resolution. Captures stderr for debugging shell
 * startup issues.
 */
function spawnCleanShellEnv(): Promise<Record<string, string>> {
	return new Promise((resolve, reject) => {
		const shell = process.env.SHELL || "/bin/sh";
		const env = buildMinimalEnv();

		const command = `echo -n "${DELIMITER}"; command env; echo -n "${DELIMITER}"; exit`;

		let child: ChildProcess;
		try {
			child = spawn(shell, ["-i", "-l", "-c", command], {
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
				env,
			});
		} catch (error) {
			return reject(
				new Error(
					`Failed to spawn shell ${shell}: ${error instanceof Error ? error.message : error}`,
				),
			);
		}

		const stdoutBuffers: Buffer[] = [];
		const stderrBuffers: Buffer[] = [];

		child.stdout?.on("data", (data: Buffer) => stdoutBuffers.push(data));
		child.stderr?.on("data", (data: Buffer) => stderrBuffers.push(data));

		const timeout = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				// Already dead
			}
			reject(
				new Error(
					`Shell environment resolution timed out after ${SHELL_ENV_TIMEOUT_MS}ms`,
				),
			);
		}, SHELL_ENV_TIMEOUT_MS);

		child.on("error", (error) => {
			clearTimeout(timeout);
			reject(
				new Error(
					`Shell process error for ${shell}: ${error.message}`,
				),
			);
		});

		child.on("close", (code, signal) => {
			clearTimeout(timeout);

			const stderr = Buffer.concat(stderrBuffers).toString("utf8").trim();
			if (stderr) {
				console.debug("[clean-shell-env] stderr:", stderr);
			}

			if (code !== 0 && code !== null) {
				return reject(
					new Error(
						`Shell ${shell} exited with code ${code}${signal ? `, signal ${signal}` : ""}`,
					),
				);
			}

			try {
				const stdout = Buffer.concat(stdoutBuffers).toString("utf8");
				resolve(parseEnvOutput(stdout));
			} catch (error) {
				reject(error);
			}
		});

		// Detach so the shell doesn't get killed if parent receives a signal
		child.unref();
	});
}

// ── Cached public API ────────────────────────────────────────────────

let cache: Record<string, string> | null = null;
let cacheTime = 0;

/**
 * Resolve a clean shell-derived environment snapshot for v2 terminal
 * construction.
 *
 * - Spawns the user's login shell with a minimal parent env
 * - Never inherits desktop/Electron runtime env
 * - Never falls back to process.env
 * - Throws on failure — callers must handle the error
 * - Results cached for 60s
 */
export async function getStrictShellEnvironment(): Promise<
	Record<string, string>
> {
	if (cache && Date.now() - cacheTime < CACHE_TTL_MS) {
		return { ...cache };
	}

	const env = await spawnCleanShellEnv();
	cache = env;
	cacheTime = Date.now();
	return { ...cache };
}

export function clearCleanShellEnvCache(): void {
	cache = null;
	cacheTime = 0;
}
