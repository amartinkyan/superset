import fs from "node:fs";
import path from "node:path";
import { SUPERSET_MANAGED_BINARIES } from "./desktop-agent-capabilities";
import { BIN_DIR } from "./paths";

export const WRAPPER_MARKER = "# Superset agent-wrapper v1";
export { SUPERSET_MANAGED_BINARIES };

const SUPERSET_MANAGED_HOOK_PATH_PATTERN = /\/\.superset(?:-[^/'"\s\\]+)?\//;

export function writeFileIfChanged(
	filePath: string,
	content: string,
	mode: number,
): boolean {
	const existing = fs.existsSync(filePath)
		? fs.readFileSync(filePath, "utf-8")
		: null;
	if (existing === content) {
		try {
			fs.chmodSync(filePath, mode);
		} catch {
			// Best effort.
		}
		return false;
	}

	fs.writeFileSync(filePath, content, { mode });
	return true;
}

export function isSupersetManagedHookCommand(
	command: string | undefined,
	scriptName: string,
): boolean {
	if (!command) return false;
	const normalized = command.replaceAll("\\", "/");
	if (!normalized.includes(`/hooks/${scriptName}`)) return false;
	return SUPERSET_MANAGED_HOOK_PATH_PATTERN.test(normalized);
}

interface ReconcileManagedEntriesOptions<T> {
	current: T[] | undefined;
	desired: T[];
	isManaged: (entry: T) => boolean;
	isEquivalent: (entry: T, desiredEntry: T) => boolean;
}

interface ReconcileManagedEntriesResult<T> {
	entries: T[];
	replacedManagedEntries: T[];
}

export function reconcileManagedEntries<T>({
	current,
	desired,
	isManaged,
	isEquivalent,
}: ReconcileManagedEntriesOptions<T>): ReconcileManagedEntriesResult<T> {
	const existing = Array.isArray(current) ? current : [];
	const entries: T[] = [];
	const replacedManagedEntries: T[] = [];

	for (const entry of existing) {
		if (!isManaged(entry)) {
			entries.push(entry);
			continue;
		}

		if (!desired.some((desiredEntry) => isEquivalent(entry, desiredEntry))) {
			replacedManagedEntries.push(entry);
		}
	}

	entries.push(...desired);

	return { entries, replacedManagedEntries };
}

/**
 * On macOS, Electron child processes cannot access the login keychain via
 * native Security framework APIs (SecItemCopyMatching) because they run
 * outside the user's GUI security session.  This causes agent binaries
 * (e.g. cursor-agent) to crash with "SecItemCopyMatching failed -50"
 * followed by a segfault.
 *
 * Mitigate by explicitly adding the login keychain to the search list
 * before exec-ing the real binary.  The `security` CLI is setuid and can
 * always reach securityd, so this restores the search list that a normal
 * interactive terminal would have.
 */
function buildMacosKeychainInit(): string {
	return `# Ensure macOS login keychain is available (Electron child processes may
# lose access to the keychain session, causing SecItemCopyMatching failures).
if [ "$(uname)" = "Darwin" ] 2>/dev/null; then
  security list-keychains -d user -s login.keychain-db 2>/dev/null || true
fi
`;
}

function buildRealBinaryResolver(): string {
	return `find_real_binary() {
  local name="$1"
  local IFS=:
  for dir in $PATH; do
    [ -z "$dir" ] && continue
    dir="\${dir%/}"
    case "$dir" in
      "${BIN_DIR}"|"$HOME"/.superset/bin|"$HOME"/.superset-*/bin) continue ;;
    esac
    if [ -x "$dir/$name" ] && [ ! -d "$dir/$name" ]; then
      printf "%s\\n" "$dir/$name"
      return 0
    fi
  done
  return 1
}
`;
}

function getMissingBinaryMessage(name: string): string {
	return `Superset: ${name} not found in PATH. Install it and ensure it is on PATH, then retry.`;
}

export function getWrapperPath(binaryName: string): string {
	return path.join(BIN_DIR, binaryName);
}

export function buildWrapperScript(
	binaryName: string,
	execLine: string,
): string {
	return `#!/bin/bash
${WRAPPER_MARKER}
# Superset wrapper for ${binaryName}

${buildMacosKeychainInit()}
${buildRealBinaryResolver()}
REAL_BIN="$(find_real_binary "${binaryName}")"
if [ -z "$REAL_BIN" ]; then
  echo "${getMissingBinaryMessage(binaryName)}" >&2
  exit 127
fi

${execLine}
`;
}

export function createWrapper(binaryName: string, script: string): void {
	const changed = writeFileIfChanged(getWrapperPath(binaryName), script, 0o755);
	console.log(
		`[agent-setup] ${changed ? "Updated" : "Verified"} ${binaryName} wrapper`,
	);
}
