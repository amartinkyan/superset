import { describe, expect, test } from "bun:test";

/**
 * The TERMINAL_PREVIEW string from FontPreview.tsx uses box-drawing characters
 * (╭, ─, ╮, │, ╰, ╯) to render bordered boxes. In a monospace font, every
 * line within a box must have the same character count so that left and right
 * borders align vertically.
 *
 * See: https://github.com/superset-sh/superset/issues/3427
 */

// Mirror the exact string from FontPreview.tsx so the test stays in sync.
const TERMINAL_PREVIEW = `╭─ mastra agent ── feat/add-tool ───────────╮
│ ✓ Created inputSchema with zod            │
│ ✓ Wired execute handler                   │
│ ⯿ Running tool integration tests...       │
╰───────────────────────────────────────────╯
╭─ mastra agent ── fix/workspace-sandbox ───╮
│ ✓ Patched LocalSandbox timeout            │
│ ✓ Updated workspace config                │
│ ✓ All 5 tests passing                     │
╰───────────────────────────────────────────╯
╭─ mastra agent ── chore/mcp-server ────────╮
│ ⯿ Registering tools with MCP server...    │
╰───────────────────────────────────────────╯

 3 agents running · 2 workspaces · 8 files changed

 Friends don't let friends compact.`;

/**
 * Parse TERMINAL_PREVIEW into boxes. Each box starts with a ╭ line and ends
 * with a ╰ line. Returns an array of { lines, startIndex } objects.
 */
function parseBoxes(text: string) {
	const lines = text.split("\n");
	const boxes: { lines: string[]; startIndex: number }[] = [];
	let current: { lines: string[]; startIndex: number } | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith("╭")) {
			current = { lines: [line], startIndex: i };
		} else if (current) {
			current.lines.push(line);
			if (line.startsWith("╰")) {
				boxes.push(current);
				current = null;
			}
		}
	}
	return boxes;
}

describe("FontPreview TERMINAL_PREVIEW", () => {
	test("all lines within each box have equal character length", () => {
		const boxes = parseBoxes(TERMINAL_PREVIEW);

		expect(boxes.length).toBe(3);

		for (const box of boxes) {
			const lengths = box.lines.map((l) => l.length);
			const expected = lengths[0];

			for (let i = 1; i < box.lines.length; i++) {
				expect(lengths[i]).toBe(expected);
			}
		}
	});

	test("top and bottom borders of each box have equal length", () => {
		const boxes = parseBoxes(TERMINAL_PREVIEW);

		for (const box of boxes) {
			const top = box.lines[0];
			const bottom = box.lines[box.lines.length - 1];
			expect(top.length).toBe(bottom.length);
		}
	});
});
