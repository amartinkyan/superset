import { describe, expect, test } from "bun:test";
import { lightTheme } from "./light";

/**
 * Parse an oklch color string to extract the lightness component (0–1).
 * Supports `oklch(L C H)` where L may be a decimal like 0.97.
 */
function parseLightness(color: string): number {
	const match = color.match(/oklch\(\s*([\d.]+)/);
	if (!match) throw new Error(`Could not parse oklch lightness from: ${color}`);
	return Number.parseFloat(match[1]);
}

describe("light theme contrast", () => {
	test("active workspace background (muted) has sufficient contrast against sidebar background", () => {
		const sidebarLightness = parseLightness(lightTheme.ui.sidebar);
		const mutedLightness = parseLightness(lightTheme.ui.muted);

		// The lightness difference between the sidebar background and the active
		// workspace item background (bg-muted) must be at least 3% to be visible.
		// Before the fix this was only 1.5% (0.985 vs 0.97).
		const diff = Math.abs(sidebarLightness - mutedLightness);
		expect(diff).toBeGreaterThanOrEqual(0.03);
	});

	test("accent color has sufficient contrast against sidebar background", () => {
		const sidebarLightness = parseLightness(lightTheme.ui.sidebar);
		const accentLightness = parseLightness(lightTheme.ui.accent);

		const diff = Math.abs(sidebarLightness - accentLightness);
		expect(diff).toBeGreaterThanOrEqual(0.03);
	});
});
