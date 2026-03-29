import { type RefObject, useEffect, useRef } from "react";

/**
 * Module-level cache for scroll positions.
 * Survives React unmount/remount cycles (workspace switches).
 */
const scrollCache = new Map<string, number>();

/**
 * Preserves the scroll position of a DOM container across unmount/remount cycles.
 *
 * Attaches a scroll listener to track the current `scrollTop`, saves it to a
 * module-level cache on cleanup, and restores it on mount.
 *
 * Use this for plain scrollable containers (diff viewer, rendered markdown,
 * changes list, chat messages, etc.). Does NOT cover virtual-scroll systems
 * like CodeMirror or xterm.js — those need their own save/restore mechanisms.
 *
 * @param containerRef - Ref to the scrollable DOM element
 * @param cacheKey     - Stable key identifying the scroll context (e.g. paneId, worktreePath)
 * @param deps         - Extra dependencies that, when changed, signal the container ref
 *                       may have been (re-)populated (e.g. loading flags, data objects)
 */
export function useScrollPreservation(
	containerRef: RefObject<HTMLElement | null>,
	cacheKey: string,
	deps: readonly unknown[] = [],
) {
	const lastScrollTopRef = useRef(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: containerRef is a stable ref object — we read .current inside the effect, not as a dep
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// Restore saved scroll position after the browser paints
		const saved = scrollCache.get(cacheKey);
		if (saved != null) {
			requestAnimationFrame(() => {
				container.scrollTop = saved;
			});
		}

		const onScroll = () => {
			lastScrollTopRef.current = container.scrollTop;
		};
		container.addEventListener("scroll", onScroll);

		return () => {
			container.removeEventListener("scroll", onScroll);
			scrollCache.set(cacheKey, lastScrollTopRef.current);
		};
	}, [cacheKey, ...deps]);
}

/** Clear a single cached entry (e.g. when a pane is permanently closed). */
export function clearScrollCache(cacheKey: string) {
	scrollCache.delete(cacheKey);
}
