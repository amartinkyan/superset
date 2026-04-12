/**
 * Reproduction tests for issue #3385:
 * "Cannot use keyboard shortcuts from apps running in the terminal"
 *
 * Root cause: `setupKeyboardHandler` in helpers.ts returned `false` for ALL
 * ctrl/meta key combinations that weren't in the small terminal-reserved set
 * (ctrl+c/d/z/s/q/\). Returning `false` from xterm's custom key event
 * handler tells xterm not to process the event — the event bubbles to the
 * document where react-hotkeys-hook listens for registered app hotkeys.
 *
 * The problem: combos like ctrl+p and ctrl+o (used by terminal apps such as
 * oh-my-pi, vim, less, etc.) are NOT registered app hotkeys. They bubble to
 * the document, nothing handles them, and the terminal app never receives the
 * keystroke.
 *
 * Fix: use `resolveHotkeyFromEvent` to check whether the combo matches a
 * registered app hotkey. If it does → return false (let it bubble to the app).
 * If it doesn't → return true (let xterm forward it to the PTY).
 */
import { describe, expect, test } from "bun:test";

import { resolveHotkeyFromEvent } from "renderer/hotkeys";
import { isTerminalReservedEvent } from "renderer/hotkeys/utils/utils";

// ---------------------------------------------------------------------------
// Helper: create a minimal KeyboardEvent-like object for testing.
// Uses `event.code` (not `event.key`) because resolveHotkeyFromEvent
// normalizes via event.code.
// ---------------------------------------------------------------------------

function makeKeyEvent(
	opts: Partial<KeyboardEvent> & { code: string },
): KeyboardEvent {
	return {
		type: "keydown",
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		key: opts.code.replace(/^Key/, "").toLowerCase(),
		...opts,
	} as unknown as KeyboardEvent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("issue #3385 — terminal keyboard shortcut passthrough", () => {
	describe("ctrl+p and ctrl+o are NOT registered app hotkeys", () => {
		test("ctrl+p does not resolve to any app hotkey", () => {
			const event = makeKeyEvent({
				code: "KeyP",
				ctrlKey: true,
			});
			expect(resolveHotkeyFromEvent(event)).toBeNull();
		});

		test("ctrl+o does not resolve to any app hotkey", () => {
			const event = makeKeyEvent({
				code: "KeyO",
				ctrlKey: true,
			});
			expect(resolveHotkeyFromEvent(event)).toBeNull();
		});
	});

	describe("ctrl+p and ctrl+o are NOT terminal-reserved events", () => {
		test("ctrl+p is not terminal-reserved", () => {
			const event = makeKeyEvent({
				code: "KeyP",
				key: "p",
				ctrlKey: true,
			});
			expect(isTerminalReservedEvent(event)).toBe(false);
		});

		test("ctrl+o is not terminal-reserved", () => {
			const event = makeKeyEvent({
				code: "KeyO",
				key: "o",
				ctrlKey: true,
			});
			expect(isTerminalReservedEvent(event)).toBe(false);
		});
	});

	describe("keyboard handler decision logic", () => {
		// This mirrors the decision made in setupKeyboardHandler for any
		// ctrl/meta combo that is neither a special-cased binding nor
		// terminal-reserved.
		//
		// BEFORE fix: handler always returned false → xterm ignores, keystroke lost
		// AFTER fix:  handler returns false only for registered app hotkeys

		function shouldXtermHandle(event: KeyboardEvent): boolean {
			if (isTerminalReservedEvent(event)) return true;
			if (event.type === "keydown" && (event.metaKey || event.ctrlKey)) {
				return resolveHotkeyFromEvent(event) === null;
			}
			return true;
		}

		test("ctrl+p should be handled by xterm (passed to PTY)", () => {
			const event = makeKeyEvent({ code: "KeyP", ctrlKey: true });
			expect(shouldXtermHandle(event)).toBe(true);
		});

		test("ctrl+o should be handled by xterm (passed to PTY)", () => {
			const event = makeKeyEvent({ code: "KeyO", ctrlKey: true });
			expect(shouldXtermHandle(event)).toBe(true);
		});

		test("ctrl+r should be handled by xterm (reverse search)", () => {
			const event = makeKeyEvent({ code: "KeyR", ctrlKey: true });
			expect(shouldXtermHandle(event)).toBe(true);
		});

		test("ctrl+a should be handled by xterm (start of line)", () => {
			const event = makeKeyEvent({ code: "KeyA", ctrlKey: true });
			expect(shouldXtermHandle(event)).toBe(true);
		});

		test("ctrl+e should be handled by xterm (end of line)", () => {
			const event = makeKeyEvent({ code: "KeyE", ctrlKey: true });
			expect(shouldXtermHandle(event)).toBe(true);
		});

		test("ctrl+c should be handled by xterm (terminal-reserved)", () => {
			const event = makeKeyEvent({
				code: "KeyC",
				key: "c",
				ctrlKey: true,
			});
			expect(shouldXtermHandle(event)).toBe(true);
		});

		test("ctrl+1 should NOT be handled by xterm (OPEN_PRESET_1 app hotkey)", () => {
			const event = makeKeyEvent({ code: "Digit1", ctrlKey: true });
			expect(shouldXtermHandle(event)).toBe(false);
		});
	});
});
