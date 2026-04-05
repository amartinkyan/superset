/**
 * Runtime env stripping for v2 terminals.
 *
 * Removes host-service runtime secrets, Node/app keys, and build-tool
 * env vars from the base env before it reaches user PTYs.
 *
 * Design: denylist approach. The host-service base env is a shell-derived
 * snapshot that already contains only user shell vars + explicit runtime
 * additions from desktop. We strip the known runtime additions rather
 * than allowlisting, because the shell snapshot should pass through
 * untouched (it has the user's version managers, proxy config, etc.).
 */

/** Exact keys injected by desktop into host-service that must not leak to PTYs. */
const HOST_SERVICE_RUNTIME_KEYS = new Set([
	"AUTH_TOKEN",
	"CLOUD_API_URL",
	"KEEP_ALIVE_AFTER_PARENT",
	"ORGANIZATION_ID",
]);

/** Node/app keys that should not reach user terminals. */
const NODE_APP_KEYS = new Set(["NODE_ENV", "NODE_OPTIONS", "NODE_PATH"]);

/**
 * Prefixes for internal runtime env that must not leak to PTYs.
 * Covers: dev-runner, Electron, VS Code, build tools, and
 * host-service/desktop control categories (HOST_*, DESKTOP_*, DEVICE_*).
 */
const STRIP_PREFIXES = [
	"npm_",
	"npm_config_",
	"ELECTRON_",
	"VITE_",
	"NEXT_PUBLIC_",
	"TURBO_",
	"HOST_",
	"DESKTOP_",
	"DEVICE_",
];

/** Explicit Superset support keys to keep when present. */
const SUPERSET_KEEP_KEYS = new Set([
	"SUPERSET_HOME_DIR",
	"SUPERSET_AGENT_HOOK_PORT",
	"SUPERSET_AGENT_HOOK_VERSION",
]);

/**
 * Strip host-service runtime env from a base env snapshot.
 *
 * Removes:
 * - Host-service runtime keys (secrets, control vars)
 * - Node/app keys (NODE_ENV, NODE_OPTIONS, NODE_PATH)
 * - Build-tool prefix keys (VITE_*, NEXT_PUBLIC_*, TURBO_*)
 * - All SUPERSET_* keys except the explicit keep list
 *
 * Preserves everything else (user shell vars, version managers, proxy, SSH, etc.).
 */
export function stripTerminalRuntimeEnv(
	baseEnv: Record<string, string>,
): Record<string, string> {
	const result: Record<string, string> = {};

	for (const [key, value] of Object.entries(baseEnv)) {
		if (HOST_SERVICE_RUNTIME_KEYS.has(key)) continue;
		if (NODE_APP_KEYS.has(key)) continue;
		if (STRIP_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
		if (key.startsWith("SUPERSET_") && !SUPERSET_KEEP_KEYS.has(key)) continue;

		result[key] = value;
	}

	return result;
}
