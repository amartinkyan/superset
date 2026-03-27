import { readFileSync } from "node:fs";
import os from "node:os";

/**
 * Get the physical memory footprint (PSS — Proportional Set Size) for the
 * given PIDs by reading `/proc/<pid>/smaps_rollup`.
 *
 * PSS divides each shared page by the number of processes sharing it,
 * making it semantically equivalent to macOS `ri_phys_footprint` for the
 * purpose of "how much physical RAM does this process actually use?"
 *
 * `smaps_rollup` is a single aggregated file available on Linux kernels
 * ≥ 4.14 — it is an O(1) read regardless of mapping count.
 *
 * On non-Linux platforms an empty object is returned.
 * Missing or inaccessible PIDs (ENOENT, EACCES, EPERM) are silently omitted.
 *
 * @returns A map from PID to PSS in bytes.
 */
export function getPhysFootprints(pids: number[]): Record<number, number> {
	if (os.platform() !== "linux" || !Array.isArray(pids) || pids.length === 0) {
		return {};
	}

	const result: Record<number, number> = {};

	for (const pid of pids) {
		const pss = readPssFromSmapsRollup(pid);
		if (pss !== null) {
			result[pid] = pss;
		}
	}

	return result;
}

/**
 * Read the PSS value from `/proc/<pid>/smaps_rollup`.
 *
 * The file contains lines like:
 *   Pss:               12345 kB
 *
 * We look for the `Pss:` line and convert from kB to bytes.
 *
 * @returns PSS in bytes, or `null` if the file is missing/inaccessible
 *          or the kernel does not expose `smaps_rollup`.
 */
export function readPssFromSmapsRollup(pid: number): number | null {
	try {
		const content = readFileSync(`/proc/${pid}/smaps_rollup`, "utf-8");
		return parsePssFromSmapsContent(content);
	} catch {
		// ENOENT (PID exited), EACCES/EPERM (not owned), or kernel < 4.14.
		return null;
	}
}

const PSS_REGEX = /^Pss:\s+(\d+)\s+kB$/m;

/**
 * Parse the PSS value from the content of a `smaps_rollup` file.
 * Exported for testing.
 */
export function parsePssFromSmapsContent(content: string): number | null {
	const match = PSS_REGEX.exec(content);
	if (!match?.[1]) return null;

	const kB = Number.parseInt(match[1], 10);
	if (!Number.isFinite(kB)) return null;

	return kB * 1024;
}
