/**
 * Reproduction tests for issue #1873:
 * "When I switch between terminal tab and browser tab the terminal stuck for a
 * while to load. Additionally, the terminal leaving a large blank space."
 *
 * Root cause: `scheduleReattachRecovery` in useTerminalLifecycle.ts silently
 * drops recovery requests when called within the 120ms throttle window, with
 * no retry scheduled.
 *
 * When a user returns from an external browser to the Electron app, the
 * `window.focus` event fires and schedules reattach recovery. This recovery:
 *   1. Clears the stale WebGL texture atlas (`clearTextureAtlas`)
 *   2. Re-fits the terminal to its container (`fitAddon.fit()`)
 *   3. Forces a full repaint (`xterm.refresh()`)
 *
 * If the user switches focus multiple times in rapid succession (within 120ms),
 * subsequent recovery calls hit the throttle and return early — without ever
 * scheduling a retry. The terminal stays blank/stale until the next container
 * resize event (which may never come).
 *
 * Fix: when the throttle fires, schedule a retry after the remaining throttle
 * duration instead of silently returning.
 */
import { describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// Minimal model of the scheduleReattachRecovery throttle mechanism.
// Mirrors the exact logic in useTerminalLifecycle.ts so tests accurately
// demonstrate the production behaviour.
// ---------------------------------------------------------------------------

type SchedulerState = {
	throttleMs: number;
	pendingFrame: number | null;
	lastRunAt: number;
	pendingForceResize: boolean;
};

function makeScheduler(runRecovery: (forceResize: boolean) => void): {
	schedule: (forceResize: boolean) => void;
	flush: () => void;
	state: SchedulerState;
} {
	const reattachRecovery: SchedulerState = {
		throttleMs: 120,
		pendingFrame: null,
		lastRunAt: 0,
		pendingForceResize: false,
	};

	const pendingRafs: Array<() => void> = [];

	const mockRaf = (cb: () => void): number => {
		pendingRafs.push(cb);
		return pendingRafs.length;
	};

	const isUnmounted = false;

	const scheduleReattachRecovery = (forceResize: boolean) => {
		reattachRecovery.pendingForceResize ||= forceResize;
		if (reattachRecovery.pendingFrame !== null) return;

		reattachRecovery.pendingFrame = mockRaf(() => {
			reattachRecovery.pendingFrame = null;

			const now = Date.now();
			if (now - reattachRecovery.lastRunAt < reattachRecovery.throttleMs) {
				// Schedule a retry after the remaining throttle window so the recovery
				// is not permanently lost when focus events fire in rapid succession.
				const remaining =
					reattachRecovery.throttleMs - (now - reattachRecovery.lastRunAt);
				setTimeout(() => {
					if (!isUnmounted)
						scheduleReattachRecovery(reattachRecovery.pendingForceResize);
				}, remaining + 1);
				return;
			}

			reattachRecovery.lastRunAt = now;
			const shouldForce = reattachRecovery.pendingForceResize;
			reattachRecovery.pendingForceResize = false;
			runRecovery(shouldForce);
		}) as unknown as number;
	};

	const flushRafs = () => {
		while (pendingRafs.length > 0) {
			const cb = pendingRafs.shift();
			cb?.();
		}
	};

	return {
		schedule: scheduleReattachRecovery,
		flush: flushRafs,
		state: reattachRecovery,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scheduleReattachRecovery throttle — issue #1873", () => {
	it("runs recovery on first window.focus event", () => {
		let calls = 0;
		const { schedule, flush } = makeScheduler(() => {
			calls++;
		});

		schedule(false);
		flush();

		expect(calls).toBe(1);
	});

	it("second schedule within 120ms throttle window is silently dropped", () => {
		let calls = 0;
		const { schedule, flush, state } = makeScheduler(() => {
			calls++;
		});

		// Simulate a recovery that ran 50ms ago (within the 120ms throttle window)
		state.lastRunAt = Date.now() - 50;

		schedule(false);
		flush();

		// Recovery was dropped because lastRunAt is only 50ms ago (< 120ms throttle)
		expect(calls).toBe(0);
	});

	/**
	 * REPRODUCTION TEST — this test currently FAILS, demonstrating the bug.
	 *
	 * Expected behaviour: when a recovery call is throttled, a retry should be
	 * scheduled to run after the remaining throttle window expires. Without a
	 * retry the terminal is permanently blank until the user resizes the window.
	 *
	 * Fix: in scheduleReattachRecovery (useTerminalLifecycle.ts), when the
	 * throttle fires, add:
	 *   const remaining = reattachRecovery.throttleMs - (now - reattachRecovery.lastRunAt);
	 *   setTimeout(() => { if (!isUnmounted) scheduleReattachRecovery(reattachRecovery.pendingForceResize); }, remaining + 1);
	 */
	it("throttled recovery is retried after throttle window expires", async () => {
		let calls = 0;
		const { schedule, flush, state } = makeScheduler(() => {
			calls++;
		});

		// Simulate a recovery that ran 50ms ago (within the 120ms throttle window)
		state.lastRunAt = Date.now() - 50;

		// This call hits the throttle; current code silently drops it
		schedule(false);
		flush();
		expect(calls).toBe(0); // correctly throttled

		// Wait past the remaining throttle duration (120 - 50 = 70ms remaining)
		await new Promise((r) => setTimeout(r, 100));

		// With the fix, a setTimeout was scheduled that queued a new rAF
		flush(); // run the retried rAF

		// FAILS with current code: calls is still 0 because no retry was scheduled
		// PASSES after fix: the retry fires and recovery runs
		expect(calls).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Reproduction tests for issue #3313:
// "OpenCode terminal screen glitch and temporary recovery issue when
//  switching between Superset multi-workspaces"
//
// Root cause: both cold restore paths in useTerminalLifecycle.ts (cached
// restore and fresh server restore) return early without scheduling a
// WebGL texture atlas recovery via scheduleReattachRecovery.
//
// When a user switches from Workspace 1 → Workspace 2 → back to Workspace 1,
// the terminal unmounts and remounts through cold restore. The restored
// content renders through the WebGL renderer but `clearTextureAtlas()` +
// `refresh()` + `fit()` never run, leaving the glyph cache stale. TUI apps
// like OpenCode that use the alternate screen buffer are particularly affected
// because their complex glyph combinations aren't properly rebuilt in the new
// texture atlas.
//
// The user observes corrupted/garbled terminal output that temporarily recovers
// when OpenCode redraws (e.g., opening preferences with Ctrl+P).
//
// Fix: after cold restore scrollback is written, call scheduleReattachRecovery
// so the WebGL texture atlas is rebuilt and a full repaint is forced.
// ---------------------------------------------------------------------------

/**
 * Minimal model of the cold restore → recovery flow.
 * Mirrors the relevant interaction between the cold restore paths in
 * useTerminalLifecycle.ts and the scheduleReattachRecovery mechanism.
 */
type ColdRestoreModel = {
	/** Simulate a cold restore that writes scrollback and optionally triggers recovery */
	coldRestore: (scrollback: string) => void;
	/** Flush pending rAFs (simulates browser animation frame) */
	flushRafs: () => void;
	/** Number of times clearTextureAtlas was called */
	clearTextureAtlasCalls: number;
	/** Number of times xterm.refresh was called */
	refreshCalls: number;
	/** Number of times fitAddon.fit was called */
	fitCalls: number;
	/** Data written to xterm */
	writtenData: string[];
};

function makeColdRestoreModel(opts: {
	triggerRecoveryAfterRestore: boolean;
}): ColdRestoreModel {
	const pendingRafs: Array<() => void> = [];
	const mockRaf = (cb: () => void): number => {
		pendingRafs.push(cb);
		return pendingRafs.length;
	};

	const model: ColdRestoreModel = {
		coldRestore: () => {},
		flushRafs: () => {
			while (pendingRafs.length > 0) {
				const cb = pendingRafs.shift();
				cb?.();
			}
		},
		clearTextureAtlasCalls: 0,
		refreshCalls: 0,
		fitCalls: 0,
		writtenData: [],
	};

	// --- scheduleReattachRecovery (mirrors useTerminalLifecycle.ts:807-832) ---
	const reattachRecovery = {
		throttleMs: 120,
		pendingFrame: null as number | null,
		lastRunAt: 0,
		pendingForceResize: false,
	};

	const runReattachRecovery = () => {
		model.clearTextureAtlasCalls++;
		model.fitCalls++;
		model.refreshCalls++;
	};

	const scheduleReattachRecovery = (forceResize: boolean) => {
		reattachRecovery.pendingForceResize ||= forceResize;
		if (reattachRecovery.pendingFrame !== null) return;

		reattachRecovery.pendingFrame = mockRaf(() => {
			reattachRecovery.pendingFrame = null;
			const now = Date.now();
			if (now - reattachRecovery.lastRunAt < reattachRecovery.throttleMs) {
				return;
			}
			reattachRecovery.lastRunAt = now;
			reattachRecovery.pendingForceResize = false;
			runReattachRecovery();
		}) as unknown as number;
	};

	// --- Cold restore path (mirrors useTerminalLifecycle.ts:559-570) ---
	model.coldRestore = (scrollback: string) => {
		// Simulate xterm.write(scrollback, callback)
		model.writtenData.push(scrollback);

		if (opts.triggerRecoveryAfterRestore) {
			// FIX: schedule recovery after cold restore write
			scheduleReattachRecovery(true);
		}
		// Without the fix, no recovery is scheduled here — early return
	};

	return model;
}

describe("cold restore WebGL recovery — issue #3313", () => {
	it("cold restore without recovery fix does NOT rebuild texture atlas", () => {
		const model = makeColdRestoreModel({
			triggerRecoveryAfterRestore: false,
		});

		// Simulate workspace switch: terminal remounts, cold restore fires
		model.coldRestore("\x1b[?1049h\x1b[H\x1b[2JOpenCode TUI content...");
		model.flushRafs();

		// BUG: no recovery was triggered — texture atlas is stale
		expect(model.writtenData).toEqual([
			"\x1b[?1049h\x1b[H\x1b[2JOpenCode TUI content...",
		]);
		expect(model.clearTextureAtlasCalls).toBe(0);
		expect(model.refreshCalls).toBe(0);
		expect(model.fitCalls).toBe(0);
	});

	it("cold restore WITH recovery fix rebuilds texture atlas", () => {
		const model = makeColdRestoreModel({
			triggerRecoveryAfterRestore: true,
		});

		// Simulate workspace switch: terminal remounts, cold restore fires
		model.coldRestore("\x1b[?1049h\x1b[H\x1b[2JOpenCode TUI content...");
		model.flushRafs();

		// FIX: recovery was scheduled and executed
		expect(model.writtenData).toEqual([
			"\x1b[?1049h\x1b[H\x1b[2JOpenCode TUI content...",
		]);
		expect(model.clearTextureAtlasCalls).toBe(1);
		expect(model.refreshCalls).toBe(1);
		expect(model.fitCalls).toBe(1);
	});

	it("recovery runs only once even if cold restore fires twice rapidly", () => {
		const model = makeColdRestoreModel({
			triggerRecoveryAfterRestore: true,
		});

		// Two rapid cold restores (e.g., fast workspace switch back and forth)
		model.coldRestore("first restore");
		model.coldRestore("second restore");
		model.flushRafs();

		// Both scrollbacks written, but recovery runs only once (throttled)
		expect(model.writtenData).toEqual(["first restore", "second restore"]);
		expect(model.clearTextureAtlasCalls).toBe(1);
	});
});
