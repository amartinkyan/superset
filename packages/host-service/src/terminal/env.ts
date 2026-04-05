/**
 * V2 terminal environment contract.
 *
 * Composes the final PTY env from:
 * - env-strip.ts: runtime env stripping
 * - shell-launch.ts: shell resolution, bootstrap env, launch args
 * - this file: shell snapshot preservation, locale, metadata, final assembly
 *
 * PTY env is built from a preserved shell snapshot captured at host-service
 * startup — never from the live host-service process.env.
 */

// Re-export sub-modules for consumers that import from "./env"
export { stripTerminalRuntimeEnv } from "./env-strip";
export {
	getShellBootstrapEnv,
	getShellLaunchArgs,
	getSupersetShellPaths,
	resolveLaunchShell,
} from "./shell-launch";
export type { ShellBootstrapParams, ShellLaunchParams } from "./shell-launch";

import { stripTerminalRuntimeEnv } from "./env-strip";
import { getShellBootstrapEnv } from "./shell-launch";

// ── Shell snapshot preservation ──────────────────────────────────────

/**
 * The preserved shell-derived base env, captured once at host-service startup.
 * PTY construction reads from this — never from live process.env.
 */
let _terminalBaseEnv: Record<string, string> | null = null;

/**
 * Capture the terminal base env from the current process.env at startup.
 *
 * Must be called once, early in host-service initialization, before any
 * runtime code modifies process.env. The host-service process env at this
 * point is: shellSnapshot + explicit runtime additions from desktop.
 * Stripping the known runtime additions recovers the original shell snapshot.
 */
export function initTerminalBaseEnv(): void {
	const snapshot: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === "string") {
			snapshot[key] = value;
		}
	}
	_terminalBaseEnv = stripTerminalRuntimeEnv(snapshot);
}

/**
 * Return the preserved shell snapshot for PTY env construction.
 * Throws if initTerminalBaseEnv() was not called at startup.
 */
export function getTerminalBaseEnv(): Record<string, string> {
	if (!_terminalBaseEnv) {
		throw new Error(
			"Terminal base env not initialized. Call initTerminalBaseEnv() at host-service startup.",
		);
	}
	return { ..._terminalBaseEnv };
}

/**
 * Reset preserved terminal base env. For testing only.
 */
export function resetTerminalBaseEnvForTests(): void {
	_terminalBaseEnv = null;
}

// ── Locale ───────────────────────────────────────────────────────────

/**
 * Normalize a UTF-8 locale from the base env.
 *
 * Matches VS Code's getLangEnvVariable pattern: prefer existing locale
 * from the env, default to en_US.UTF-8.
 */
export function normalizeUtf8Locale(baseEnv: Record<string, string>): string {
	if (baseEnv.LANG?.includes("UTF-8")) return baseEnv.LANG;
	if (baseEnv.LC_ALL?.includes("UTF-8")) return baseEnv.LC_ALL;
	return "en_US.UTF-8";
}

// ── V2 terminal env construction ─────────────────────────────────────

interface BuildV2TerminalEnvParams {
	baseEnv: Record<string, string>;
	shell: string;
	supersetHomeDir: string;
	cwd: string;
	terminalId: string;
	workspaceId: string;
	workspacePath: string;
	rootPath: string;
	hostServiceVersion: string;
	supersetEnv: "development" | "production";
	agentHookPort: string;
	agentHookVersion: string;
}

/**
 * Build the final v2 PTY environment.
 *
 * baseEnv must be the preserved shell snapshot from getTerminalBaseEnv(),
 * not a snapshot of host-service process.env.
 *
 * Assembly order:
 * 1. Start from baseEnv (already stripped at init time)
 * 2. Merge shell bootstrap env (zsh ZDOTDIR redirect, etc.)
 * 3. Inject public terminal surface (TERM, TERM_PROGRAM, COLORTERM, LANG)
 * 4. Inject Superset v2 metadata (terminal/workspace/agent hook vars)
 */
export function buildV2TerminalEnv(
	params: BuildV2TerminalEnvParams,
): Record<string, string> {
	const {
		baseEnv,
		shell,
		supersetHomeDir,
		cwd,
		terminalId,
		workspaceId,
		workspacePath,
		rootPath,
		hostServiceVersion,
		supersetEnv,
		agentHookPort,
		agentHookVersion,
	} = params;

	// 1. Strip runtime keys (defense in depth — baseEnv should already be
	//    pre-stripped via initTerminalBaseEnv, but we strip again to guarantee
	//    no runtime keys reach PTYs regardless of call site)
	const env = stripTerminalRuntimeEnv(baseEnv);

	// 2. Merge shell bootstrap env
	const bootstrapEnv = getShellBootstrapEnv({
		shell,
		baseEnv,
		supersetHomeDir,
	});
	Object.assign(env, bootstrapEnv);

	// 3. Public terminal surface
	env.TERM = "xterm-256color";
	env.TERM_PROGRAM = "Superset";
	env.TERM_PROGRAM_VERSION = hostServiceVersion;
	env.COLORTERM = "truecolor";
	env.LANG = normalizeUtf8Locale(baseEnv);
	env.PWD = cwd;

	// 4. Superset v2 metadata
	env.SUPERSET_TERMINAL_ID = terminalId;
	env.SUPERSET_WORKSPACE_ID = workspaceId;
	env.SUPERSET_WORKSPACE_PATH = workspacePath;
	env.SUPERSET_ROOT_PATH = rootPath;
	env.SUPERSET_ENV = supersetEnv;
	env.SUPERSET_AGENT_HOOK_PORT = agentHookPort;
	env.SUPERSET_AGENT_HOOK_VERSION = agentHookVersion;

	return env;
}
