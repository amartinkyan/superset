import { describe, expect, test } from "bun:test";
import {
	getPresetIcon,
	isEmoji,
	PRESET_ICONS,
	resolvePresetIcon,
} from "./index";

describe("isEmoji", () => {
	test("returns true for common emojis", () => {
		expect(isEmoji("🚀")).toBe(true);
		expect(isEmoji("🧪")).toBe(true);
		expect(isEmoji("⚡")).toBe(true);
		expect(isEmoji("🎉")).toBe(true);
	});

	test("returns true for emoji with variation selector", () => {
		expect(isEmoji("⭐")).toBe(true);
	});

	test("returns true for ZWJ sequences", () => {
		// Family emoji (ZWJ sequence)
		expect(isEmoji("👨‍👩‍👧‍👦")).toBe(true);
	});

	test("returns false for ASCII text", () => {
		expect(isEmoji("hello")).toBe(false);
		expect(isEmoji("a")).toBe(false);
		expect(isEmoji("123")).toBe(false);
	});

	test("returns false for empty string", () => {
		expect(isEmoji("")).toBe(false);
	});

	test("returns false for text with emoji mixed in", () => {
		expect(isEmoji("hello 🚀")).toBe(false);
		expect(isEmoji("🚀 server")).toBe(false);
	});

	test("returns false for icon keys", () => {
		expect(isEmoji("claude")).toBe(false);
		expect(isEmoji("codex")).toBe(false);
	});
});

describe("resolvePresetIcon", () => {
	test("returns emoji result when iconOverride is an emoji", () => {
		const result = resolvePresetIcon("anything", false, "🚀");
		expect(result).toEqual({ type: "emoji", emoji: "🚀" });
	});

	test("returns img result when iconOverride matches a PRESET_ICONS key", () => {
		const result = resolvePresetIcon("anything", false, "claude");
		expect(result).toBeDefined();
		expect(result?.type).toBe("img");
		expect(result).toHaveProperty("src");
	});

	test("icon override takes priority over preset name match", () => {
		// preset name is "claude" but icon override is an emoji
		const result = resolvePresetIcon("claude", false, "🧪");
		expect(result).toEqual({ type: "emoji", emoji: "🧪" });
	});

	test("icon override key takes priority over preset name match", () => {
		// preset name is "claude" but icon override points to "codex"
		const result = resolvePresetIcon("claude", false, "codex");
		expect(result?.type).toBe("img");
		// Should be codex icon, not claude icon
		const claudeResult = resolvePresetIcon("claude", false);
		expect(result).not.toEqual(claudeResult);
	});

	test("falls back to preset name match when no override", () => {
		const result = resolvePresetIcon("claude", false);
		expect(result?.type).toBe("img");
		expect(result).toHaveProperty("src");
	});

	test("falls back to preset name match when override is empty", () => {
		const result = resolvePresetIcon("claude", false, "");
		expect(result?.type).toBe("img");
	});

	test("falls back to preset name match when override is whitespace", () => {
		const result = resolvePresetIcon("claude", false, "  ");
		expect(result?.type).toBe("img");
	});

	test("returns undefined when no match at all", () => {
		const result = resolvePresetIcon("custom-preset", false);
		expect(result).toBeUndefined();
	});

	test("returns undefined when override does not match and name does not match", () => {
		const result = resolvePresetIcon("custom-preset", false, "nonexistent");
		expect(result).toBeUndefined();
	});

	test("is case-insensitive for override key", () => {
		const result = resolvePresetIcon("anything", false, "Claude");
		expect(result?.type).toBe("img");
	});

	test("is case-insensitive for preset name", () => {
		const result = resolvePresetIcon("CLAUDE", false);
		expect(result?.type).toBe("img");
	});

	test("respects isDark for light theme", () => {
		const result = resolvePresetIcon("codex", false);
		expect(result?.type).toBe("img");
		if (result?.type === "img") {
			expect(result.src).toBe(PRESET_ICONS.codex.light);
		}
	});

	test("respects isDark for dark theme", () => {
		const result = resolvePresetIcon("codex", true);
		expect(result?.type).toBe("img");
		if (result?.type === "img") {
			expect(result.src).toBe(PRESET_ICONS.codex.dark);
		}
	});
});

describe("getPresetIcon (backward compatibility)", () => {
	test("returns icon src string for known preset", () => {
		const result = getPresetIcon("claude", false);
		expect(typeof result).toBe("string");
		expect(result).toBeDefined();
	});

	test("returns undefined for unknown preset", () => {
		const result = getPresetIcon("unknown-preset", false);
		expect(result).toBeUndefined();
	});
});
