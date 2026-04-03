import { describe, expect, test } from "bun:test";
import {
	getSidebarHeaderTabButtonClassName,
	sidebarHeaderTabTriggerClassName,
} from "./headerTabStyles";

describe("headerTabStyles - light theme active tab contrast (#3147)", () => {
	test("active tab should have light-mode-aware background that differs from dark mode", () => {
		const activeClasses = getSidebarHeaderTabButtonClassName({
			isActive: true,
		});

		// The active tab must use dark: prefix to differentiate light vs dark mode styling.
		// Without this, bg-border/30 makes active tabs darker in light mode (bug).
		expect(activeClasses).toContain("dark:");

		// Active tab in light mode should use bg-background (white) to match
		// standard light theme conventions where the active tab is lightest.
		expect(activeClasses).toContain("bg-background");
	});

	test("inactive tab should have light-mode-aware hover background", () => {
		const inactiveClasses = getSidebarHeaderTabButtonClassName({
			isActive: false,
		});

		// Inactive tab hover should also be theme-aware
		expect(inactiveClasses).toContain("hover:");
	});

	test("sidebarHeaderTabTriggerClassName active state should be theme-aware", () => {
		const classes = sidebarHeaderTabTriggerClassName;

		// The data-[state=active] styling must include dark: variant
		// to avoid the inverted contrast issue in light mode
		expect(classes).toContain("dark:");
		expect(classes).toContain("data-[state=active]:bg-background");
	});
});
