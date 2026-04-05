import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import type { Terminal as XTerm } from "@xterm/xterm";

// Mock localStorage for Node.js test environment
const mockStorage = new Map<string, string>();
const mockLocalStorage = {
	getItem: (key: string) => mockStorage.get(key) ?? null,
	setItem: (key: string, value: string) => mockStorage.set(key, value),
	removeItem: (key: string) => mockStorage.delete(key),
	clear: () => mockStorage.clear(),
};

// @ts-expect-error - mocking global localStorage
globalThis.localStorage = mockLocalStorage;

// Mock trpc-client to avoid electronTRPC dependency
mock.module("renderer/lib/trpc-client", () => ({
	electronTrpcClient: {
		external: {
			openUrl: { mutate: mock(() => Promise.resolve()) },
			openFileInEditor: { mutate: mock(() => Promise.resolve()) },
		},
		uiState: {
			hotkeys: {
				get: { query: mock(() => Promise.resolve(null)) },
				set: { mutate: mock(() => Promise.resolve()) },
			},
			theme: {
				get: { query: mock(() => Promise.resolve(null)) },
				set: { mutate: mock(() => Promise.resolve()) },
			},
		},
	},
	electronReactClient: {},
}));

// Import after mocks are set up
const {
	getDefaultTerminalBg,
	getDefaultTerminalTheme,
	setupCopyHandler,
	setupKeyboardHandler,
	setupPasteHandler,
	setupResizeHandlers,
} = await import("./helpers");

describe("getDefaultTerminalTheme", () => {
	beforeEach(() => {
		mockStorage.clear();
	});

	afterEach(() => {
		mockStorage.clear();
	});

	it("should return cached terminal colors from localStorage", () => {
		const cachedTerminal = {
			background: "#272822",
			foreground: "#f8f8f2",
			cursor: "#f8f8f0",
			red: "#f92672",
			green: "#a6e22e",
		};
		localStorage.setItem("theme-terminal", JSON.stringify(cachedTerminal));

		const theme = getDefaultTerminalTheme();

		expect(theme.background).toBe("#272822");
		expect(theme.foreground).toBe("#f8f8f2");
		expect(theme.cursor).toBe("#f8f8f0");
	});

	it("should fall back to theme-id lookup when no cached terminal", () => {
		localStorage.setItem("theme-id", "light");

		const theme = getDefaultTerminalTheme();

		// Light theme has white background
		expect(theme.background).toBe("#ffffff");
	});

	it("should fall back to default dark theme when localStorage is empty", () => {
		const theme = getDefaultTerminalTheme();

		// Default theme is dark (ember)
		expect(theme.background).toBe("#151110");
	});

	it("should handle invalid JSON in cached terminal gracefully", () => {
		localStorage.setItem("theme-terminal", "invalid json{");

		const theme = getDefaultTerminalTheme();

		// Should fall back to default
		expect(theme.background).toBe("#151110");
	});
});

afterAll(() => {
	mock.restore();
});

describe("getDefaultTerminalBg", () => {
	beforeEach(() => {
		mockStorage.clear();
	});

	afterEach(() => {
		mockStorage.clear();
	});

	it("should return background from cached theme", () => {
		localStorage.setItem(
			"theme-terminal",
			JSON.stringify({ background: "#282c34" }),
		);

		expect(getDefaultTerminalBg()).toBe("#282c34");
	});

	it("should return default background when no cache", () => {
		expect(getDefaultTerminalBg()).toBe("#151110");
	});
});

describe("setupKeyboardHandler", () => {
	const originalNavigator = globalThis.navigator;

	afterEach(() => {
		// Restore navigator between tests
		globalThis.navigator = originalNavigator;
	});

	it("maps Option+Left/Right to Meta+B/F on macOS", () => {
		// @ts-expect-error - mocking navigator for tests
		globalThis.navigator = { platform: "MacIntel" };

		const captured: { handler: ((event: KeyboardEvent) => boolean) | null } = {
			handler: null,
		};
		const xterm = {
			attachCustomKeyEventHandler: (
				next: (event: KeyboardEvent) => boolean,
			) => {
				captured.handler = next;
			},
		};

		const onWrite = mock(() => {});
		setupKeyboardHandler(xterm as unknown as XTerm, { onWrite });

		captured.handler?.({
			type: "keydown",
			key: "ArrowLeft",
			altKey: true,
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
		} as KeyboardEvent);
		captured.handler?.({
			type: "keydown",
			key: "ArrowRight",
			altKey: true,
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
		} as KeyboardEvent);

		expect(onWrite).toHaveBeenCalledWith("\x1bb");
		expect(onWrite).toHaveBeenCalledWith("\x1bf");
	});

	it("maps Ctrl+Left/Right to Meta+B/F on Windows", () => {
		// @ts-expect-error - mocking navigator for tests
		globalThis.navigator = { platform: "Win32" };

		const captured: { handler: ((event: KeyboardEvent) => boolean) | null } = {
			handler: null,
		};
		const xterm = {
			attachCustomKeyEventHandler: (
				next: (event: KeyboardEvent) => boolean,
			) => {
				captured.handler = next;
			},
		};

		const onWrite = mock(() => {});
		setupKeyboardHandler(xterm as unknown as XTerm, { onWrite });

		captured.handler?.({
			type: "keydown",
			key: "ArrowLeft",
			altKey: false,
			metaKey: false,
			ctrlKey: true,
			shiftKey: false,
		} as KeyboardEvent);
		captured.handler?.({
			type: "keydown",
			key: "ArrowRight",
			altKey: false,
			metaKey: false,
			ctrlKey: true,
			shiftKey: false,
		} as KeyboardEvent);

		expect(onWrite).toHaveBeenCalledWith("\x1bb");
		expect(onWrite).toHaveBeenCalledWith("\x1bf");
	});
});

describe("setupCopyHandler", () => {
	const originalNavigator = globalThis.navigator;

	afterEach(() => {
		globalThis.navigator = originalNavigator;
	});

	function createXtermStub(selection: string) {
		const listeners = new Map<string, EventListener>();
		const element = {
			addEventListener: mock((eventName: string, listener: EventListener) => {
				listeners.set(eventName, listener);
			}),
			removeEventListener: mock((eventName: string) => {
				listeners.delete(eventName);
			}),
		} as unknown as HTMLElement;
		const xterm = {
			element,
			getSelection: mock(() => selection),
		} as unknown as XTerm;
		return { xterm, listeners };
	}

	it("trims trailing whitespace and writes to clipboardData when available", () => {
		const { xterm, listeners } = createXtermStub("foo   \nbar  ");
		setupCopyHandler(xterm);

		const preventDefault = mock(() => {});
		const setData = mock(() => {});
		const copyEvent = {
			preventDefault,
			clipboardData: { setData },
		} as unknown as ClipboardEvent;

		const copyListener = listeners.get("copy");
		expect(copyListener).toBeDefined();
		copyListener?.(copyEvent);

		expect(preventDefault).toHaveBeenCalled();
		expect(setData).toHaveBeenCalledWith("text/plain", "foo\nbar");
	});

	it("prefers clipboardData path over navigator.clipboard fallback", () => {
		const { xterm, listeners } = createXtermStub("foo   \nbar  ");
		const writeText = mock(() => Promise.resolve());

		// @ts-expect-error - mocking navigator for tests
		globalThis.navigator = { clipboard: { writeText } };

		setupCopyHandler(xterm);

		const preventDefault = mock(() => {});
		const setData = mock(() => {});
		const copyEvent = {
			preventDefault,
			clipboardData: { setData },
		} as unknown as ClipboardEvent;

		const copyListener = listeners.get("copy");
		expect(copyListener).toBeDefined();
		copyListener?.(copyEvent);

		expect(preventDefault).toHaveBeenCalled();
		expect(setData).toHaveBeenCalledWith("text/plain", "foo\nbar");
		expect(writeText).not.toHaveBeenCalled();
	});

	it("falls back to navigator.clipboard.writeText when clipboardData is missing", () => {
		const { xterm, listeners } = createXtermStub("foo   \nbar  ");
		const writeText = mock(() => Promise.resolve());

		// @ts-expect-error - mocking navigator for tests
		globalThis.navigator = { clipboard: { writeText } };

		setupCopyHandler(xterm);

		const preventDefault = mock(() => {});
		const copyEvent = {
			preventDefault,
			clipboardData: null,
		} as unknown as ClipboardEvent;

		const copyListener = listeners.get("copy");
		expect(copyListener).toBeDefined();
		copyListener?.(copyEvent);

		expect(preventDefault).not.toHaveBeenCalled();
		expect(writeText).toHaveBeenCalledWith("foo\nbar");
	});

	it("does not throw when clipboardData is missing and navigator.clipboard is unavailable", () => {
		const { xterm, listeners } = createXtermStub("foo   \nbar  ");

		// @ts-expect-error - mocking navigator for tests
		globalThis.navigator = {};

		setupCopyHandler(xterm);

		const copyEvent = {
			preventDefault: mock(() => {}),
			clipboardData: null,
		} as unknown as ClipboardEvent;

		const copyListener = listeners.get("copy");
		expect(copyListener).toBeDefined();
		expect(() => copyListener?.(copyEvent)).not.toThrow();
	});
});

describe("setupPasteHandler", () => {
	function createXtermStub() {
		const listeners = new Map<string, EventListener>();
		const textarea = {
			addEventListener: mock((eventName: string, listener: EventListener) => {
				listeners.set(eventName, listener);
			}),
			removeEventListener: mock((eventName: string) => {
				listeners.delete(eventName);
			}),
		} as unknown as HTMLTextAreaElement;
		const paste = mock(() => {});
		const xterm = {
			textarea,
			paste,
		} as unknown as XTerm;
		return { xterm, listeners, paste };
	}

	it("forwards Ctrl+V for image-only clipboard payloads", () => {
		const { xterm, listeners } = createXtermStub();
		const onWrite = mock(() => {});
		setupPasteHandler(xterm, { onWrite });

		const preventDefault = mock(() => {});
		const stopImmediatePropagation = mock(() => {});
		const pasteEvent = {
			clipboardData: {
				getData: mock(() => ""),
				items: [{ kind: "file", type: "image/png" }],
				types: ["Files", "image/png"],
			},
			preventDefault,
			stopImmediatePropagation,
		} as unknown as ClipboardEvent;

		const pasteListener = listeners.get("paste");
		expect(pasteListener).toBeDefined();
		pasteListener?.(pasteEvent);

		expect(onWrite).toHaveBeenCalledWith("\x16");
		expect(preventDefault).toHaveBeenCalled();
		expect(stopImmediatePropagation).toHaveBeenCalled();
	});

	it("forwards Ctrl+V for non-text clipboard payloads without plain text", () => {
		const { xterm, listeners } = createXtermStub();
		const onWrite = mock(() => {});
		setupPasteHandler(xterm, { onWrite });

		const preventDefault = mock(() => {});
		const stopImmediatePropagation = mock(() => {});
		const pasteEvent = {
			clipboardData: {
				getData: mock(() => ""),
				items: [{ kind: "string", type: "text/html" }],
				types: ["text/html"],
			},
			preventDefault,
			stopImmediatePropagation,
		} as unknown as ClipboardEvent;

		const pasteListener = listeners.get("paste");
		expect(pasteListener).toBeDefined();
		pasteListener?.(pasteEvent);

		expect(onWrite).toHaveBeenCalledWith("\x16");
		expect(preventDefault).toHaveBeenCalled();
		expect(stopImmediatePropagation).toHaveBeenCalled();
	});

	it("ignores empty clipboard payloads", () => {
		const { xterm, listeners } = createXtermStub();
		const onWrite = mock(() => {});
		setupPasteHandler(xterm, { onWrite });

		const preventDefault = mock(() => {});
		const stopImmediatePropagation = mock(() => {});
		const pasteEvent = {
			clipboardData: {
				getData: mock(() => ""),
				items: [],
				types: [],
			},
			preventDefault,
			stopImmediatePropagation,
		} as unknown as ClipboardEvent;

		const pasteListener = listeners.get("paste");
		expect(pasteListener).toBeDefined();
		pasteListener?.(pasteEvent);

		expect(onWrite).not.toHaveBeenCalled();
		expect(preventDefault).not.toHaveBeenCalled();
		expect(stopImmediatePropagation).not.toHaveBeenCalled();
	});
});

describe("setupResizeHandlers", () => {
	// Mock ResizeObserver and requestAnimationFrame for test environment
	const originalResizeObserver = globalThis.ResizeObserver;
	const originalRAF = globalThis.requestAnimationFrame;
	beforeEach(() => {
		globalThis.ResizeObserver = class MockResizeObserver {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
		globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
			cb(0);
			return 0;
		};
	});
	afterEach(() => {
		if (originalResizeObserver) {
			globalThis.ResizeObserver = originalResizeObserver;
		}
		if (originalRAF) {
			globalThis.requestAnimationFrame = originalRAF;
		}
	});

	function createResizeStubs(initialCols = 80, initialRows = 24) {
		let cols = initialCols;
		let rows = initialRows;
		const fitAddon = {
			fit: mock(() => {}),
		};
		const xterm = {
			get cols() {
				return cols;
			},
			get rows() {
				return rows;
			},
			buffer: { active: { viewportY: 0, baseY: 10 } },
			scrollToBottom: mock(() => {}),
		};
		const container = document.createElement("div");
		return {
			xterm: xterm as unknown as XTerm,
			fitAddon,
			container,
			setDimensions(c: number, r: number) {
				cols = c;
				rows = r;
			},
		};
	}

	it("calls onResize when dimensions change after fit", async () => {
		const { xterm, fitAddon, container, setDimensions } = createResizeStubs(
			80,
			24,
		);
		const onResize = mock(() => {});

		// Make fitAddon.fit() simulate a dimension change
		fitAddon.fit.mockImplementation(() => setDimensions(100, 30));

		const cleanup = setupResizeHandlers(
			container,
			xterm,
			fitAddon as never,
			onResize,
		);

		// Trigger window resize
		window.dispatchEvent(new Event("resize"));

		// Wait for debounce (150ms) + buffer
		await new Promise((r) => setTimeout(r, 200));

		expect(fitAddon.fit).toHaveBeenCalled();
		expect(onResize).toHaveBeenCalledWith(100, 30);

		cleanup();
	});

	it("does NOT call onResize when dimensions remain unchanged after fit (zoom scenario)", async () => {
		const { xterm, fitAddon, container } = createResizeStubs(80, 24);
		const onResize = mock(() => {});

		// fitAddon.fit() does NOT change cols/rows (simulates zoom where dimensions stay the same)
		const cleanup = setupResizeHandlers(
			container,
			xterm,
			fitAddon as never,
			onResize,
		);

		// Trigger multiple window resize events (as zoom would)
		window.dispatchEvent(new Event("resize"));
		window.dispatchEvent(new Event("resize"));
		window.dispatchEvent(new Event("resize"));

		// Wait for debounce
		await new Promise((r) => setTimeout(r, 200));

		expect(fitAddon.fit).toHaveBeenCalled();
		expect(onResize).not.toHaveBeenCalled();

		cleanup();
	});

	it("calls onResize only once when multiple resize events fire with same final dimensions", async () => {
		const { xterm, fitAddon, container, setDimensions } = createResizeStubs(
			80,
			24,
		);
		const onResize = mock(() => {});

		fitAddon.fit.mockImplementation(() => setDimensions(90, 28));

		const cleanup = setupResizeHandlers(
			container,
			xterm,
			fitAddon as never,
			onResize,
		);

		// Rapid-fire resize events (simulates zoom)
		window.dispatchEvent(new Event("resize"));
		window.dispatchEvent(new Event("resize"));
		window.dispatchEvent(new Event("resize"));

		// Wait for debounce
		await new Promise((r) => setTimeout(r, 200));

		// Debounce should collapse to one call, and dimensions changed so onResize fires once
		expect(onResize).toHaveBeenCalledTimes(1);
		expect(onResize).toHaveBeenCalledWith(90, 28);

		cleanup();
	});

	it("does not call onResize after second resize if dimensions match previous resize", async () => {
		const { xterm, fitAddon, container, setDimensions } = createResizeStubs(
			80,
			24,
		);
		const onResize = mock(() => {});

		fitAddon.fit.mockImplementation(() => setDimensions(100, 30));

		const cleanup = setupResizeHandlers(
			container,
			xterm,
			fitAddon as never,
			onResize,
		);

		// First resize - dimensions change
		window.dispatchEvent(new Event("resize"));
		await new Promise((r) => setTimeout(r, 200));
		expect(onResize).toHaveBeenCalledTimes(1);

		// Second resize - dimensions stay at 100x30 (already set)
		window.dispatchEvent(new Event("resize"));
		await new Promise((r) => setTimeout(r, 200));

		// Should still only have been called once total
		expect(onResize).toHaveBeenCalledTimes(1);

		cleanup();
	});

	it("cleans up event listeners on dispose", async () => {
		const { xterm, fitAddon, container } = createResizeStubs(80, 24);
		const onResize = mock(() => {});

		const cleanup = setupResizeHandlers(
			container,
			xterm,
			fitAddon as never,
			onResize,
		);

		cleanup();

		// After cleanup, resize events should not trigger fit
		window.dispatchEvent(new Event("resize"));
		await new Promise((r) => setTimeout(r, 200));

		expect(fitAddon.fit).not.toHaveBeenCalled();
	});
});
