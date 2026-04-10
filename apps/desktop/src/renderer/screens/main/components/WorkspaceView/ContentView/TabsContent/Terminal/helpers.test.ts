/**
 * Tests for the terminal keyboard handler in helpers.ts.
 *
 * Reproduction test for issue #3337:
 * "Terminal swallows unbound Ctrl/Cmd chords that should stay inside the PTY"
 *
 * Root cause: the catch-all in setupKeyboardHandler returns false (bubble to
 * app) for ANY Ctrl/Meta keydown, even when the chord is not a registered app
 * hotkey. This prevents unbound readline/TUI chords like Ctrl+A, Ctrl+E,
 * Ctrl+B, Ctrl+O from reaching the PTY.
 *
 * Fix: only bubble Ctrl/Meta chords that resolve to a registered app hotkey
 * via resolveHotkeyFromEvent; let everything else stay in xterm.
 */
import { describe, expect, it, mock } from "bun:test";
import { setupKeyboardHandler } from "./helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture the handler passed to xterm.attachCustomKeyEventHandler */
function captureHandler(
	options: Parameters<typeof setupKeyboardHandler>[1] = {},
): (event: KeyboardEvent) => boolean {
	let captured: ((event: KeyboardEvent) => boolean) | null = null;
	const fakeXterm = {
		attachCustomKeyEventHandler: (fn: (event: KeyboardEvent) => boolean) => {
			captured = fn;
		},
	};
	setupKeyboardHandler(fakeXterm as never, options);
	if (!captured) throw new Error("Handler was not captured");
	return captured;
}

/** Create a minimal KeyboardEvent-like object */
function makeKeyEvent(
	key: string,
	opts: {
		ctrlKey?: boolean;
		metaKey?: boolean;
		altKey?: boolean;
		shiftKey?: boolean;
		type?: string;
		code?: string;
	} = {},
): KeyboardEvent {
	return {
		key,
		code: opts.code ?? `Key${key.toUpperCase()}`,
		ctrlKey: opts.ctrlKey ?? false,
		metaKey: opts.metaKey ?? false,
		altKey: opts.altKey ?? false,
		shiftKey: opts.shiftKey ?? false,
		type: opts.type ?? "keydown",
		preventDefault: mock(() => {}),
	} as unknown as KeyboardEvent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("setupKeyboardHandler", () => {
	describe("terminal-reserved chords stay in xterm", () => {
		it.each(["c", "d", "z", "s", "q"])("Ctrl+%s → true (xterm)", (letter) => {
			const handler = captureHandler();
			const event = makeKeyEvent(letter, { ctrlKey: true });
			expect(handler(event)).toBe(true);
		});
	});

	describe("unbound Ctrl chords stay in xterm (issue #3337)", () => {
		// These are standard readline / TUI chords that have no registered app
		// hotkey on any platform. They MUST return true so xterm forwards them
		// to the PTY.
		const unboundChords = [
			{ key: "a", label: "Ctrl+A (beginning of line)" },
			{ key: "e", label: "Ctrl+E (end of line)" },
			{ key: "b", label: "Ctrl+B (backward char)" },
			{ key: "f", label: "Ctrl+F (forward char)" },
			{ key: "o", label: "Ctrl+O (operate-and-get-next)" },
			{ key: "n", label: "Ctrl+N (next history)" },
			{ key: "p", label: "Ctrl+P (previous history)" },
			{ key: "r", label: "Ctrl+R (reverse search)" },
			{ key: "t", label: "Ctrl+T (transpose chars)" },
			{ key: "u", label: "Ctrl+U (kill line)" },
			{ key: "w", label: "Ctrl+W (kill word)" },
			{ key: "y", label: "Ctrl+Y (yank)" },
		];

		for (const { key, label } of unboundChords) {
			it(`${label} → true (xterm handles)`, () => {
				const handler = captureHandler();
				const event = makeKeyEvent(key, { ctrlKey: true });
				expect(handler(event)).toBe(true);
			});
		}
	});

	describe("registered app hotkeys bubble to document", () => {
		// On Linux, registered app hotkeys use ctrl+shift+<key> patterns.
		// These should return false so they bubble to the app layer.
		it("Ctrl+Shift+B (toggle workspace sidebar on Linux) → false", () => {
			const handler = captureHandler();
			const event = makeKeyEvent("b", {
				ctrlKey: true,
				shiftKey: true,
				code: "KeyB",
			});
			expect(handler(event)).toBe(false);
		});

		it("Ctrl+Shift+T (new terminal on Linux) → false", () => {
			const handler = captureHandler();
			const event = makeKeyEvent("t", {
				ctrlKey: true,
				shiftKey: true,
				code: "KeyT",
			});
			expect(handler(event)).toBe(false);
		});
	});

	describe("plain keys stay in xterm", () => {
		it("regular letter → true", () => {
			const handler = captureHandler();
			const event = makeKeyEvent("a", { code: "KeyA" });
			expect(handler(event)).toBe(true);
		});

		it("Enter → true", () => {
			const handler = captureHandler();
			const event = makeKeyEvent("Enter", { code: "Enter" });
			expect(handler(event)).toBe(true);
		});
	});
});
