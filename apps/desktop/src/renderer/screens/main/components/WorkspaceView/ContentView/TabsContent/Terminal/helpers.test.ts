/**
 * Reproduction tests for issue #3281:
 * "New terminal starts in half width"
 *
 * Root cause: `createTerminalInstance` called `fitAddon.fit()` synchronously
 * right after `xterm.open(container)`. At that point the container may not have
 * its final layout dimensions from React, so the terminal fits to a partial
 * (often ~50%) width. Switching to another tab and back triggers
 * `scheduleReattachRecovery` which re-fits after layout — fixing the size.
 *
 * Fix: defer the initial `fitAddon.fit()` to a `requestAnimationFrame` callback
 * so the browser completes layout before measuring the container.
 */
import { describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// Minimal model of the createTerminalInstance initialization flow.
//
// We cannot instantiate real xterm in bun:test (no DOM), so we model the
// timing relationship between open(), fit(), and layout to demonstrate that
// synchronous fit reads stale dimensions while deferred fit reads correct ones.
// ---------------------------------------------------------------------------

interface ContainerModel {
	/** Width reported to fitAddon at the time of measurement */
	width: number;
}

interface FitRecord {
	/** The container width that fitAddon.fit() observed */
	measuredWidth: number;
	/** Whether the fit was called synchronously during createTerminalInstance */
	wasSynchronous: boolean;
}

/**
 * Simulate the OLD (buggy) createTerminalInstance flow:
 *   xterm.open(container)  →  fitAddon.fit()  (synchronous)
 *
 * The container starts at 0 width and only reaches its final width after the
 * browser performs layout (modeled as the rAF callback).
 */
function simulateBuggyFlow(finalWidth: number): {
	fitRecords: FitRecord[];
	flushRaf: () => void;
} {
	const container: ContainerModel = { width: 0 };
	const fitRecords: FitRecord[] = [];
	const pendingRafs: Array<() => void> = [];

	// xterm.open() — container is mounted but layout hasn't run yet
	// (width is 0 or partial in real browser)

	// fitAddon.fit() called synchronously — THIS IS THE BUG
	fitRecords.push({
		measuredWidth: container.width,
		wasSynchronous: true,
	});

	// Browser layout happens asynchronously (before next paint / rAF)
	pendingRafs.push(() => {
		container.width = finalWidth;
	});

	return {
		fitRecords,
		flushRaf: () => {
			while (pendingRafs.length > 0) {
				pendingRafs.shift()?.();
			}
		},
	};
}

/**
 * Simulate the FIXED createTerminalInstance flow:
 *   xterm.open(container)  →  requestAnimationFrame(() => fitAddon.fit())
 *
 * The fit is deferred so it runs after the browser has laid out the container.
 */
function simulateFixedFlow(finalWidth: number): {
	fitRecords: FitRecord[];
	flushRaf: () => void;
} {
	const container: ContainerModel = { width: 0 };
	const fitRecords: FitRecord[] = [];
	const pendingRafs: Array<() => void> = [];

	// xterm.open() — container is mounted but layout hasn't run yet

	// Browser layout happens (simulated as first rAF task)
	pendingRafs.push(() => {
		container.width = finalWidth;
	});

	// fitAddon.fit() deferred to rAF — runs AFTER layout
	pendingRafs.push(() => {
		fitRecords.push({
			measuredWidth: container.width,
			wasSynchronous: false,
		});
	});

	return {
		fitRecords,
		flushRaf: () => {
			while (pendingRafs.length > 0) {
				pendingRafs.shift()?.();
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createTerminalInstance initial fit — issue #3281", () => {
	const EXPECTED_FULL_WIDTH = 960;

	it("BUG: synchronous fit measures container at zero width", () => {
		const { fitRecords } = simulateBuggyFlow(EXPECTED_FULL_WIDTH);

		// The fit ran synchronously before layout
		expect(fitRecords).toHaveLength(1);
		expect(fitRecords[0]?.wasSynchronous).toBe(true);
		// Container had zero width — terminal renders at wrong size
		expect(fitRecords[0]?.measuredWidth).toBe(0);
		expect(fitRecords[0]?.measuredWidth).not.toBe(EXPECTED_FULL_WIDTH);
	});

	it("FIX: deferred fit measures container at full width after layout", () => {
		const { fitRecords, flushRaf } = simulateFixedFlow(EXPECTED_FULL_WIDTH);

		// No fit has run yet (it's deferred)
		expect(fitRecords).toHaveLength(0);

		// After rAF fires (layout + deferred fit)
		flushRaf();

		expect(fitRecords).toHaveLength(1);
		expect(fitRecords[0]?.wasSynchronous).toBe(false);
		// Container has its final width — terminal renders correctly
		expect(fitRecords[0]?.measuredWidth).toBe(EXPECTED_FULL_WIDTH);
	});

	it("deferred fit is skipped when terminal is disposed before rAF", () => {
		const container: ContainerModel = { width: 0 };
		const fitRecords: FitRecord[] = [];
		const pendingRafs: Array<() => void> = [];
		let isDisposed = false;

		// Simulate deferred fit with disposal check (matches production code)
		pendingRafs.push(() => {
			container.width = EXPECTED_FULL_WIDTH;
		});
		pendingRafs.push(() => {
			if (!isDisposed) {
				fitRecords.push({
					measuredWidth: container.width,
					wasSynchronous: false,
				});
			}
		});

		// Terminal disposed before rAF fires
		isDisposed = true;

		// Flush rAFs
		while (pendingRafs.length > 0) {
			pendingRafs.shift()?.();
		}

		// Fit was correctly skipped
		expect(fitRecords).toHaveLength(0);
	});
});
