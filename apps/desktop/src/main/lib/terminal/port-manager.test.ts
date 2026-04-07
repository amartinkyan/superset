import { describe, expect, test } from "bun:test";
import { IDLE_SESSION_TIMEOUT_MS, SCAN_INTERVAL_MS } from "./port-manager";

/**
 * Tests for PortManager EDR-related optimizations.
 *
 * Before the fix:
 * - Periodic scan ran every 2,500ms, spawning ps + lsof for every registered
 *   session. With 13 sessions that's ~14 process spawns every 2.5s — each
 *   intercepted by the EDR agent.
 * - All sessions were scanned regardless of activity, so idle terminals
 *   without dev servers still triggered process spawns.
 *
 * After the fix:
 * - Periodic scan interval increased to 10,000ms (hint-based scans still
 *   fire within 500ms of detecting "listening on port X" in output).
 * - Sessions with no detected ports and no recent port-hint output (>60s)
 *   are skipped entirely during periodic scans.
 */

describe("PortManager EDR optimizations", () => {
	test("scan interval is 10 seconds (increased from 2.5s)", () => {
		expect(SCAN_INTERVAL_MS).toBe(10_000);
	});

	test("idle session timeout is 60 seconds", () => {
		expect(IDLE_SESSION_TIMEOUT_MS).toBe(60_000);
	});

	test("scan interval is at least 4x the original 2500ms", () => {
		// The original value was 2500ms. The new value should be significantly
		// larger to reduce process spawn frequency.
		expect(SCAN_INTERVAL_MS).toBeGreaterThanOrEqual(10_000);
	});
});
