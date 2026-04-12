/**
 * Reproduction tests for issue #3370:
 * "[bug] Control+<Key> shortcuts are broken in 1.5.0"
 *
 * Root cause: `setupKeyboardHandler` in helpers.ts contained a catch-all that
 * returned `false` for ALL `Ctrl/Meta + key` combos on keydown:
 *
 *   if (event.type === "keydown" && (event.metaKey || event.ctrlKey))
 *       return false;
 *
 * Returning `false` from xterm's `attachCustomKeyEventHandler` tells xterm to
 * ignore the event — it never reaches the PTY. This meant shell shortcuts
 * like Ctrl+R (reverse search), Ctrl+L (clear), Ctrl+A (home), Ctrl+W
 * (delete word), etc. were silently swallowed.
 *
 * Fix: only return false for chords that are registered app hotkeys (using
 * `resolveHotkeyFromEvent`), letting all other Ctrl/Meta combos through to
 * xterm.
 */
import { describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// We test the keyboard handler logic in isolation by extracting it from
// setupKeyboardHandler. The function calls xterm.attachCustomKeyEventHandler
// with a handler — we capture that handler via a mock xterm and exercise it.
// ---------------------------------------------------------------------------

// Mock resolveHotkeyFromEvent so we control which chords are "app hotkeys"
// without pulling in the full registry (which needs DOM/navigator).
const MOCK_APP_HOTKEYS = new Set([
	"meta+bracketleft", // NAVIGATE_BACK (mac)
	"meta+p", // QUICK_OPEN (mac)
	"meta+1", // JUMP_TO_WORKSPACE_1 (mac)
]);

mock.module("renderer/hotkeys", () => ({
	getBinding: (_id: string) => null,
	isTerminalReservedEvent: (event: KeyboardEvent) => {
		if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
			return false;
		const key = event.key.toLowerCase();
		return ["c", "d", "z", "s", "q", "\\"].includes(key);
	},
	resolveHotkeyFromEvent: (event: KeyboardEvent) => {
		if (event.type !== "keydown") return null;
		const mods: string[] = [];
		if (event.metaKey) mods.push("meta");
		if (event.ctrlKey) mods.push("ctrl");
		if (event.altKey) mods.push("alt");
		if (event.shiftKey) mods.push("shift");
		mods.sort();
		const key = event.key.toLowerCase();
		const chord = [...mods, key].join("+");
		return MOCK_APP_HOTKEYS.has(chord) ? chord : null;
	},
}));

// Stub external modules that helpers.ts imports at top level
mock.module("@superset/ui/sonner", () => ({ toast: { error: () => {} } }));
mock.module("@xterm/addon-clipboard", () => ({
	ClipboardAddon: class {},
}));
mock.module("@xterm/addon-fit", () => ({
	FitAddon: class {
		activate() {}
		dispose() {}
		fit() {}
	},
}));
mock.module("@xterm/addon-image", () => ({ ImageAddon: class {} }));
mock.module("@xterm/addon-ligatures", () => ({ LigaturesAddon: class {} }));
mock.module("@xterm/addon-search", () => ({
	SearchAddon: class {
		activate() {}
		dispose() {}
	},
}));
mock.module("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
mock.module("@xterm/addon-webgl", () => ({ WebglAddon: class {} }));
mock.module("@xterm/xterm", () => ({
	Terminal: class {
		attachCustomKeyEventHandler() {}
		loadAddon() {}
	},
}));
mock.module("renderer/lib/trpc-client", () => ({
	electronTrpcClient: {},
}));
mock.module("renderer/stores/theme/utils", () => ({
	toXtermTheme: () => ({}),
}));
mock.module("shared/themes", () => ({
	builtInThemes: [],
	DEFAULT_THEME_ID: "default",
	getTerminalColors: () => null,
}));

// Now import the function under test AFTER mocks are set up
const { setupKeyboardHandler } = await import("./helpers");

// ---------------------------------------------------------------------------
// Helper: create a fake xterm that captures the key handler
// ---------------------------------------------------------------------------
function captureHandler(): (event: KeyboardEvent) => boolean {
	let captured: ((event: KeyboardEvent) => boolean) | null = null;
	const fakeXterm = {
		attachCustomKeyEventHandler: (fn: (event: KeyboardEvent) => boolean) => {
			captured = fn;
		},
	};

	setupKeyboardHandler(fakeXterm as never);

	if (!captured) throw new Error("handler was not attached");
	return captured;
}

// ---------------------------------------------------------------------------
// Helper: create a minimal KeyboardEvent-like object
// ---------------------------------------------------------------------------
function makeKeyEvent(
	key: string,
	opts: {
		ctrlKey?: boolean;
		metaKey?: boolean;
		altKey?: boolean;
		shiftKey?: boolean;
		type?: string;
	} = {},
): KeyboardEvent {
	return {
		key,
		code: `Key${key.toUpperCase()}`,
		type: opts.type ?? "keydown",
		ctrlKey: opts.ctrlKey ?? false,
		metaKey: opts.metaKey ?? false,
		altKey: opts.altKey ?? false,
		shiftKey: opts.shiftKey ?? false,
		preventDefault: () => {},
		stopPropagation: () => {},
	} as unknown as KeyboardEvent;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("setupKeyboardHandler — Ctrl+key forwarding (#3370)", () => {
	const handler = captureHandler();

	it("allows Ctrl+R (reverse search) to reach xterm", () => {
		const event = makeKeyEvent("r", { ctrlKey: true });
		// true = xterm processes the event (sends to PTY)
		expect(handler(event)).toBe(true);
	});

	it("allows Ctrl+L (clear screen) to reach xterm", () => {
		const event = makeKeyEvent("l", { ctrlKey: true });
		expect(handler(event)).toBe(true);
	});

	it("allows Ctrl+A (beginning of line) to reach xterm", () => {
		const event = makeKeyEvent("a", { ctrlKey: true });
		expect(handler(event)).toBe(true);
	});

	it("allows Ctrl+E (end of line) to reach xterm", () => {
		const event = makeKeyEvent("e", { ctrlKey: true });
		expect(handler(event)).toBe(true);
	});

	it("allows Ctrl+W (delete word) to reach xterm", () => {
		const event = makeKeyEvent("w", { ctrlKey: true });
		expect(handler(event)).toBe(true);
	});

	it("allows terminal-reserved Ctrl+C to reach xterm", () => {
		const event = makeKeyEvent("c", { ctrlKey: true });
		expect(handler(event)).toBe(true);
	});

	it("allows terminal-reserved Ctrl+D to reach xterm", () => {
		const event = makeKeyEvent("d", { ctrlKey: true });
		expect(handler(event)).toBe(true);
	});

	it("blocks registered app hotkey Meta+P (quick open)", () => {
		const event = makeKeyEvent("p", { metaKey: true });
		// false = xterm ignores it, lets it bubble to document for app handling
		expect(handler(event)).toBe(false);
	});

	it("blocks registered app hotkey Meta+1 (workspace switch)", () => {
		const event = makeKeyEvent("1", { metaKey: true });
		expect(handler(event)).toBe(false);
	});

	it("allows unregistered Meta+key combos to reach xterm", () => {
		const event = makeKeyEvent("r", { metaKey: true });
		expect(handler(event)).toBe(true);
	});

	it("allows plain keys (no modifiers) to reach xterm", () => {
		const event = makeKeyEvent("a");
		expect(handler(event)).toBe(true);
	});
});
