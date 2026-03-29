import { type RefObject, useEffect, useRef } from "react";

/**
 * Module-level cache for scroll positions.
 * Survives React unmount/remount cycles (workspace switches).
 */
const scrollCache = new Map<string, number>();

/**
 * Restore scrollTop on a container. If the container doesn't have enough
 * content height yet (e.g. TipTap with deferred rendering), observe resize
 * events until the content is tall enough to scroll, then disconnect.
 */
function restoreScrollTop(container: HTMLElement, target: number) {
	container.scrollTop = target;
	if (container.scrollTop >= target) return;

	// Content not tall enough yet — wait for it via ResizeObserver
	const observer = new ResizeObserver(() => {
		container.scrollTop = target;
		if (container.scrollTop >= target) {
			observer.disconnect();
		}
	});
	observer.observe(container);

	// Safety: disconnect after 5s to avoid leaking observers
	setTimeout(() => observer.disconnect(), 5_000);
}

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

		// Restore saved scroll position, waiting for content if needed
		const saved = scrollCache.get(cacheKey);
		if (saved != null) {
			restoreScrollTop(container, saved);
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
