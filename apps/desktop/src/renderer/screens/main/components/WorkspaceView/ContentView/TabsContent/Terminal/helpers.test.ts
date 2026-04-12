/**
 * Reproduction tests for issue #3380:
 * "Terminal can't be used.... terminal apps just don't work any more"
 *
 * Root cause: setupKeyboardHandler's catch-all blocks ALL Ctrl/Meta key
 * combinations from reaching xterm, except the tiny TERMINAL_RESERVED set
 * (Ctrl+C/D/Z/S/Q/\). This means essential terminal shortcuts like Ctrl+A
 * (beginning of line), Ctrl+R (reverse search), Ctrl+L (clear screen),
 * Ctrl+K (kill to end of line), Ctrl+W (delete word), Ctrl+U (kill line),
 * etc. are all swallowed and never reach the PTY — making terminal apps
 * and even basic shell usage effectively broken.
 *
 * The fix: replace the catch-all with a targeted check that only blocks
 * key events matching a registered app hotkey (via resolveHotkeyFromEvent),
 * letting all other Ctrl/Meta combos pass through to xterm.
 */
import { describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// Minimal model of the keyboard handler decision logic.
//
// This mirrors the exact logic in setupKeyboardHandler (helpers.ts) so tests
// accurately demonstrate the production behaviour. We can't import the real
// function because it requires a live xterm instance and renderer-side imports
// (hotkey store, DOM, etc.), but the decision logic is the core of the bug.
// ---------------------------------------------------------------------------

/** The set of Ctrl chords that setupKeyboardHandler always passes to xterm. */
const TERMINAL_RESERVED = new Set([
	"ctrl+c",
	"ctrl+d",
	"ctrl+z",
	"ctrl+s",
	"ctrl+q",
	"ctrl+\\",
]);

function isTerminalReservedEvent(event: {
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	key: string;
}): boolean {
	if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
		return false;
	const key = event.key.toLowerCase();
	return TERMINAL_RESERVED.has(`ctrl+${key}`);
}

/**
 * Simulates the CURRENT (buggy) catch-all logic in setupKeyboardHandler.
 *
 * Returns true if the key should be forwarded to xterm, false if blocked.
 * This omits the specific Cmd+Backspace / Cmd+Arrow / Shift+Enter handlers
 * (those aren't relevant to the bug) and focuses on the catch-all path.
 */
function buggyKeyDecision(event: {
	type: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	key: string;
}): boolean {
	// Terminal-reserved chords always go to xterm
	if (isTerminalReservedEvent(event)) return true;

	// BUG: Any other ctrl/meta combo on keydown → blocked
	if (event.type === "keydown" && (event.metaKey || event.ctrlKey))
		return false;

	return true;
}

/**
 * Simulates the FIXED logic: only block key events that match a registered
 * app hotkey, letting all other Ctrl/Meta combos through to xterm.
 *
 * For this test model, we use a representative set of registered app hotkeys.
 * In production, resolveHotkeyFromEvent checks against the full HOTKEYS registry.
 */
const REGISTERED_APP_HOTKEYS_CHORDS = new Set([
	// Ctrl-only hotkeys registered on all platforms
	"ctrl+1",
	"ctrl+2",
	"ctrl+3",
	"ctrl+4",
	"ctrl+5",
	"ctrl+6",
	"ctrl+7",
	"ctrl+8",
	"ctrl+9",
	"ctrl+tab",
	"ctrl+,",
	// Meta (Cmd) hotkeys on Mac (representative subset)
	"meta+p",
	"meta+n",
	"meta+t",
	"meta+w",
	"meta+k",
	"meta+l",
	"meta+b",
	"meta+d",
	"meta+e",
	"meta+f",
	"meta+g",
	"meta+j",
	"meta+u",
	"meta+i",
	"meta+o",
]);

function isRegisteredAppHotkey(event: {
	type: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	key: string;
}): boolean {
	if (event.type !== "keydown") return false;
	const mods: string[] = [];
	if (event.metaKey) mods.push("meta");
	if (event.ctrlKey) mods.push("ctrl");
	if (event.altKey) mods.push("alt");
	if (event.shiftKey) mods.push("shift");
	mods.sort();
	const chord = [...mods, event.key.toLowerCase()].join("+");
	return REGISTERED_APP_HOTKEYS_CHORDS.has(chord);
}

function fixedKeyDecision(event: {
	type: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	key: string;
}): boolean {
	// Terminal-reserved chords always go to xterm
	if (isTerminalReservedEvent(event)) return true;

	// FIX: Only block keys that are actually registered app hotkeys
	if (isRegisteredAppHotkey(event)) return false;

	return true;
}

// ---------------------------------------------------------------------------
// Helper to build a minimal KeyboardEvent-like object
// ---------------------------------------------------------------------------

function makeKeyEvent(
	key: string,
	mods: {
		ctrl?: boolean;
		meta?: boolean;
		alt?: boolean;
		shift?: boolean;
	} = {},
) {
	return {
		type: "keydown" as const,
		key,
		ctrlKey: mods.ctrl ?? false,
		metaKey: mods.meta ?? false,
		altKey: mods.alt ?? false,
		shiftKey: mods.shift ?? false,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("setupKeyboardHandler Ctrl passthrough — issue #3380", () => {
	describe("terminal-reserved Ctrl chords always pass through", () => {
		for (const key of ["c", "d", "z", "s", "q"]) {
			it(`Ctrl+${key.toUpperCase()} passes to xterm`, () => {
				const event = makeKeyEvent(key, { ctrl: true });
				expect(buggyKeyDecision(event)).toBe(true);
				expect(fixedKeyDecision(event)).toBe(true);
			});
		}
	});

	describe("essential terminal Ctrl shortcuts are blocked by buggy handler", () => {
		const essentialCtrlKeys = [
			{ key: "a", desc: "Ctrl+A (beginning of line / tmux prefix)" },
			{ key: "b", desc: "Ctrl+B (backward char / tmux prefix)" },
			{ key: "e", desc: "Ctrl+E (end of line)" },
			{ key: "f", desc: "Ctrl+F (forward char)" },
			{ key: "g", desc: "Ctrl+G (abort)" },
			{ key: "h", desc: "Ctrl+H (backspace)" },
			{ key: "j", desc: "Ctrl+J (newline)" },
			{ key: "k", desc: "Ctrl+K (kill to end of line)" },
			{ key: "l", desc: "Ctrl+L (clear screen)" },
			{ key: "n", desc: "Ctrl+N (next history)" },
			{ key: "o", desc: "Ctrl+O (operate-and-get-next)" },
			{ key: "p", desc: "Ctrl+P (previous history)" },
			{ key: "r", desc: "Ctrl+R (reverse search)" },
			{ key: "t", desc: "Ctrl+T (transpose chars)" },
			{ key: "u", desc: "Ctrl+U (kill line)" },
			{ key: "v", desc: "Ctrl+V (literal next)" },
			{ key: "w", desc: "Ctrl+W (delete word)" },
			{ key: "x", desc: "Ctrl+X (prefix in emacs mode)" },
			{ key: "y", desc: "Ctrl+Y (yank)" },
		];

		for (const { key, desc } of essentialCtrlKeys) {
			it(`${desc} is BLOCKED by buggy handler`, () => {
				const event = makeKeyEvent(key, { ctrl: true });
				// BUG: the catch-all blocks this key from reaching xterm
				expect(buggyKeyDecision(event)).toBe(false);
			});

			it(`${desc} PASSES with fixed handler`, () => {
				const event = makeKeyEvent(key, { ctrl: true });
				// FIX: the key reaches xterm because it's not a registered app hotkey
				expect(fixedKeyDecision(event)).toBe(true);
			});
		}
	});

	describe("registered app hotkeys are still blocked by both handlers", () => {
		it("Ctrl+1 (Open Preset 1) is blocked", () => {
			const event = makeKeyEvent("1", { ctrl: true });
			expect(buggyKeyDecision(event)).toBe(false);
			expect(fixedKeyDecision(event)).toBe(false);
		});

		it("Cmd+T (New Terminal) is blocked", () => {
			const event = makeKeyEvent("t", { meta: true });
			expect(buggyKeyDecision(event)).toBe(false);
			expect(fixedKeyDecision(event)).toBe(false);
		});

		it("Cmd+W (Close Pane) is blocked", () => {
			const event = makeKeyEvent("w", { meta: true });
			expect(buggyKeyDecision(event)).toBe(false);
			expect(fixedKeyDecision(event)).toBe(false);
		});

		it("Cmd+K (Clear Terminal) is blocked", () => {
			const event = makeKeyEvent("k", { meta: true });
			expect(buggyKeyDecision(event)).toBe(false);
			expect(fixedKeyDecision(event)).toBe(false);
		});
	});

	describe("plain keys are never blocked", () => {
		it("regular letters pass through", () => {
			const event = makeKeyEvent("a", {});
			expect(buggyKeyDecision(event)).toBe(true);
			expect(fixedKeyDecision(event)).toBe(true);
		});

		it("Enter passes through", () => {
			const event = makeKeyEvent("Enter", {});
			expect(buggyKeyDecision(event)).toBe(true);
			expect(fixedKeyDecision(event)).toBe(true);
		});
	});
});
