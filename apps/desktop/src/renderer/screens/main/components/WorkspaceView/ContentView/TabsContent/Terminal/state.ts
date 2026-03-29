import type { ColdRestoreState } from "./types";

/**
 * Module-level map to track pending detach timeouts.
 * This survives React StrictMode's unmount/remount cycle, allowing us to
 * cancel a pending detach if the component immediately remounts.
 */
export const pendingDetaches = new Map<string, NodeJS.Timeout>();

/**
 * Module-level map to track cold restore state across StrictMode cycles.
 * When cold restore is detected, we store the state here so it survives
 * the unmount/remount that StrictMode causes. Without this, the first mount
 * detects cold restore and sets state, but StrictMode unmounts and remounts
 * with fresh state, losing the cold restore detection.
 */
export const coldRestoreState = new Map<string, ColdRestoreState>();

/**
 * Saved viewport line so scroll position can be restored after workspace switch.
 * Stored as absolute viewportY so it points at the same content even when new
 * output is appended at the bottom while the user is on another workspace.
 */
export const savedViewportOffset = new Map<
	string,
	{ viewportY: number }
>();
