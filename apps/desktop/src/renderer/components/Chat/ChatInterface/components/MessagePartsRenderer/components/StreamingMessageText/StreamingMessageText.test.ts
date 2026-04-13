import { describe, expect, test } from "bun:test";

const STREAM_TEXT_CHARS_PER_TICK = 2;

/**
 * Simulates the BROKEN (original) character-by-character text reveal logic.
 * Advances by charsPerTick UTF-16 code units using raw `text.slice()`.
 */
function simulateTextRevealBroken(
	text: string,
	charsPerTick: number,
): string[] {
	const frames: string[] = [];
	let length = 0;
	while (length < text.length) {
		length = Math.min(text.length, length + charsPerTick);
		frames.push(text.slice(0, length));
	}
	return frames;
}

/**
 * Simulates the FIXED text reveal logic that avoids splitting surrogate pairs.
 * If the code unit at the new length is a low surrogate, includes it to keep
 * the pair intact.
 */
function simulateTextRevealFixed(text: string, charsPerTick: number): string[] {
	const frames: string[] = [];
	let length = 0;
	while (length < text.length) {
		length = Math.min(text.length, length + charsPerTick);
		// Avoid splitting surrogate pairs
		if (length < text.length) {
			const code = text.charCodeAt(length);
			if (code >= 0xdc00 && code <= 0xdfff) {
				length++;
			}
		}
		frames.push(text.slice(0, length));
	}
	return frames;
}

/**
 * Detects lone (unpaired) surrogates — the direct cause of garbled characters.
 * A high surrogate (0xD800-0xDBFF) must be followed by a low surrogate
 * (0xDC00-0xDFFF), and a low surrogate must be preceded by a high surrogate.
 */
function hasLoneSurrogate(str: string): boolean {
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = str.charCodeAt(i + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			i++;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

function assertNoLoneSurrogates(frames: string[]) {
	const broken = frames.filter(hasLoneSurrogate);
	if (broken.length > 0) {
		throw new Error(
			`Found ${broken.length} frame(s) with lone surrogates:\n${broken.map((f) => `  ${JSON.stringify(f)}`).join("\n")}`,
		);
	}
}

describe("StreamingMessageText character slicing — bug reproduction", () => {
	test("common Chinese characters (BMP) render correctly even without fix", () => {
		const text = "你好世界，这是一个测试";
		const frames = simulateTextRevealBroken(text, STREAM_TEXT_CHARS_PER_TICK);

		assertNoLoneSurrogates(frames);
		expect(frames[frames.length - 1]).toBe(text);
	});

	test("BUG: surrogate pair CJK characters produce garbled output with raw slice", () => {
		// CJK Extension B characters — each is a surrogate pair in UTF-16
		// 𠀀 (U+20000) = \uD840\uDC00
		const text = "你𠀀好𠀁世界";
		const frames = simulateTextRevealBroken(text, STREAM_TEXT_CHARS_PER_TICK);

		// This SHOULD have no broken surrogates but the raw slice produces them
		const brokenFrames = frames.filter(hasLoneSurrogate);
		expect(brokenFrames.length).toBeGreaterThan(0);
	});

	test("BUG: ASCII + surrogate pair produces garbled output with raw slice", () => {
		const text = "A𠀀B";
		expect(text.length).toBe(4); // 1 + 2 + 1 UTF-16 code units

		const frames = simulateTextRevealBroken(text, STREAM_TEXT_CHARS_PER_TICK);
		const brokenFrames = frames.filter(hasLoneSurrogate);
		expect(brokenFrames.length).toBeGreaterThan(0);
	});
});

describe("StreamingMessageText character slicing — fix verification", () => {
	test("surrogate pair CJK characters render correctly with fix", () => {
		const text = "你𠀀好𠀁世界";
		const frames = simulateTextRevealFixed(text, STREAM_TEXT_CHARS_PER_TICK);

		assertNoLoneSurrogates(frames);
		expect(frames[frames.length - 1]).toBe(text);
	});

	test("ASCII + surrogate pair renders correctly with fix", () => {
		const text = "A𠀀B";
		const frames = simulateTextRevealFixed(text, STREAM_TEXT_CHARS_PER_TICK);

		assertNoLoneSurrogates(frames);
		expect(frames[frames.length - 1]).toBe(text);
	});

	test("emoji text renders correctly with fix", () => {
		const text = "Hello 🎉 你好 😀 World";
		const frames = simulateTextRevealFixed(text, STREAM_TEXT_CHARS_PER_TICK);

		assertNoLoneSurrogates(frames);
		expect(frames[frames.length - 1]).toBe(text);
	});

	test("common Chinese characters still work with fix", () => {
		const text = "你好世界，这是一个测试";
		const frames = simulateTextRevealFixed(text, STREAM_TEXT_CHARS_PER_TICK);

		assertNoLoneSurrogates(frames);
		expect(frames[frames.length - 1]).toBe(text);
	});

	test("pure ASCII text still works with fix", () => {
		const text = "Hello World!";
		const frames = simulateTextRevealFixed(text, STREAM_TEXT_CHARS_PER_TICK);

		assertNoLoneSurrogates(frames);
		expect(frames[frames.length - 1]).toBe(text);
	});
});

describe("TypewriterText character slicing (advance by 1) — fix verification", () => {
	test("surrogate pairs render correctly when advancing one code unit at a time", () => {
		const text = "你𠀀好";
		const frames = simulateTextRevealFixed(text, 1);

		assertNoLoneSurrogates(frames);
		expect(frames[frames.length - 1]).toBe(text);
	});

	test("BUG: surrogate pairs break when advancing one code unit with raw slice", () => {
		const text = "你𠀀好";
		const frames = simulateTextRevealBroken(text, 1);

		const brokenFrames = frames.filter(hasLoneSurrogate);
		expect(brokenFrames.length).toBeGreaterThan(0);
	});
});
