import { describe, expect, it } from "bun:test";
import {
	canonicalizeHotkey,
	canonicalizeHotkeyForPlatform,
	deriveNonMacDefault,
	HOTKEYS,
	hotkeyFromKeyboardEvent,
	isTerminalReservedEvent,
	matchesHotkeyEvent,
	toElectronAccelerator,
} from "./hotkeys";

describe("canonicalizeHotkey", () => {
	it("normalizes modifier order", () => {
		expect(canonicalizeHotkey("shift+meta+k")).toBe("meta+shift+k");
	});

	it("rejects invalid hotkeys", () => {
		expect(canonicalizeHotkey("shift+meta+k+x")).toBeNull();
	});
});

describe("canonicalizeHotkeyForPlatform", () => {
	it("rejects meta on non-mac platforms", () => {
		expect(canonicalizeHotkeyForPlatform("meta+k", "win32")).toBeNull();
	});
});

describe("deriveNonMacDefault", () => {
	it("returns null for null input", () => {
		expect(deriveNonMacDefault(null)).toBeNull();
	});

	it("returns null for invalid hotkey", () => {
		expect(deriveNonMacDefault("invalid+key+combo+extra")).toBeNull();
	});

	it("returns unchanged hotkey when no meta modifier present", () => {
		expect(deriveNonMacDefault("ctrl+k")).toBe("ctrl+k");
	});

	it("maps meta+key to ctrl+shift+key (simple meta case)", () => {
		expect(deriveNonMacDefault("meta+k")).toBe("ctrl+shift+k");
	});

	it("maps meta+shift to ctrl+alt+shift (adds alt for shifted defaults)", () => {
		expect(deriveNonMacDefault("meta+shift+w")).toBe("ctrl+alt+shift+w");
	});

	it("maps meta+alt to ctrl+alt+shift", () => {
		expect(deriveNonMacDefault("meta+alt+k")).toBe("ctrl+alt+shift+k");
	});
});

describe("hotkeyFromKeyboardEvent", () => {
	it("captures a simple meta hotkey on mac", () => {
		const keys = hotkeyFromKeyboardEvent(
			{
				key: "k",
				code: "KeyK",
				metaKey: true,
				ctrlKey: false,
				altKey: false,
				shiftKey: false,
			},
			"darwin",
		);
		expect(keys).toBe("meta+k");
	});
});

describe("toElectronAccelerator", () => {
	it("converts to electron accelerator for mac", () => {
		expect(toElectronAccelerator("meta+shift+w", "darwin")).toBe(
			"Command+Shift+W",
		);
	});

	it("returns null for meta on non-mac", () => {
		expect(toElectronAccelerator("meta+w", "win32")).toBeNull();
	});
});

describe("isTerminalReservedEvent", () => {
	it("detects ctrl+c", () => {
		expect(
			isTerminalReservedEvent({
				key: "c",
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
			}),
		).toBe(true);
	});
});

describe("CLOSE_WORKSPACE hotkey", () => {
	it("is defined in HOTKEYS with correct properties", () => {
		expect(HOTKEYS.CLOSE_WORKSPACE).toBeDefined();
		expect(HOTKEYS.CLOSE_WORKSPACE.label).toBe("Close Workspace");
		expect(HOTKEYS.CLOSE_WORKSPACE.category).toBe("Workspace");
		expect(HOTKEYS.CLOSE_WORKSPACE.defaults.darwin).toBe(
			"meta+shift+backspace",
		);
	});

	it("matches ⌘+Shift+Backspace keyboard event", () => {
		const matches = matchesHotkeyEvent(
			{
				key: "Backspace",
				code: "Backspace",
				metaKey: true,
				ctrlKey: false,
				altKey: false,
				shiftKey: true,
			},
			HOTKEYS.CLOSE_WORKSPACE.defaults.darwin ?? "",
		);
		expect(matches).toBe(true);
	});

	it("does not match ⌘+Backspace without shift", () => {
		const matches = matchesHotkeyEvent(
			{
				key: "Backspace",
				code: "Backspace",
				metaKey: true,
				ctrlKey: false,
				altKey: false,
				shiftKey: false,
			},
			HOTKEYS.CLOSE_WORKSPACE.defaults.darwin ?? "",
		);
		expect(matches).toBe(false);
	});

	it("does not conflict with existing workspace hotkeys", () => {
		const closeDefaults = HOTKEYS.CLOSE_WORKSPACE.defaults;
		const workspaceHotkeys = Object.entries(HOTKEYS)
			.filter(
				([key, def]) =>
					def.category === "Workspace" && key !== "CLOSE_WORKSPACE",
			)
			.map(([key, def]) => ({ key, defaults: def.defaults }));

		for (const hotkey of workspaceHotkeys) {
			expect(hotkey.defaults.darwin).not.toBe(closeDefaults.darwin);
			expect(hotkey.defaults.linux).not.toBe(closeDefaults.linux);
		}
	});
});

describe("Option+number on macOS (issue #3142)", () => {
	describe("hotkeyFromKeyboardEvent", () => {
		it("records alt+1 when Option+1 is pressed on Mac (event.key is ¡)", () => {
			// On macOS, Option+1 produces the special character ¡ as event.key
			const result = hotkeyFromKeyboardEvent(
				{
					key: "¡",
					code: "Digit1",
					metaKey: false,
					ctrlKey: false,
					altKey: true,
					shiftKey: false,
				},
				"darwin",
			);
			expect(result).toBe("alt+1");
		});

		it("records alt+2 when Option+2 is pressed on Mac (event.key is ™)", () => {
			const result = hotkeyFromKeyboardEvent(
				{
					key: "™",
					code: "Digit2",
					metaKey: false,
					ctrlKey: false,
					altKey: true,
					shiftKey: false,
				},
				"darwin",
			);
			expect(result).toBe("alt+2");
		});

		it("accepts alt as a valid modifier for shortcuts", () => {
			const result = hotkeyFromKeyboardEvent(
				{
					key: "¡",
					code: "Digit1",
					metaKey: false,
					ctrlKey: false,
					altKey: true,
					shiftKey: false,
				},
				"darwin",
			);
			// alt is a valid modifier — this should NOT be null
			expect(result).not.toBeNull();
		});
	});

	describe("matchesHotkeyEvent", () => {
		it("matches alt+1 when Option+1 produces special character ¡", () => {
			const matches = matchesHotkeyEvent(
				{
					key: "¡",
					code: "Digit1",
					metaKey: false,
					ctrlKey: false,
					altKey: true,
					shiftKey: false,
				},
				"alt+1",
			);
			expect(matches).toBe(true);
		});

		it("matches alt+9 when Option+9 produces special character", () => {
			const matches = matchesHotkeyEvent(
				{
					key: "ª",
					code: "Digit9",
					metaKey: false,
					ctrlKey: false,
					altKey: true,
					shiftKey: false,
				},
				"alt+9",
			);
			expect(matches).toBe(true);
		});
	});
});
