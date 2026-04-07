import { beforeEach, describe, expect, test } from "bun:test";
import {
	deleteEditorViewState,
	getEditorViewState,
	setEditorViewState,
} from "./editorViewStateCache";

/**
 * Reproduction test for GitHub issue #3226:
 * Scroll position / cursor location in file editor is lost when switching
 * between tabs.
 *
 * Root cause: The CodeEditor component is keyed by `filePath`, so it gets
 * completely destroyed and recreated on tab switches. There was no mechanism
 * to save the cursor/scroll position before unmount or restore it after
 * remount.
 *
 * Fix: An in-memory view state cache (editorViewStateCache) stores the cursor
 * position per document key. FileViewerContent saves position on unmount and
 * restores it on mount, falling back to cached state when no explicit
 * initialLine/initialColumn is provided.
 */

const DOC_KEY_A = "workspace-1::working::src/app.tsx";
const DOC_KEY_B = "workspace-1::working::src/utils.ts";

beforeEach(() => {
	deleteEditorViewState(DOC_KEY_A);
	deleteEditorViewState(DOC_KEY_B);
});

describe("editorViewStateCache", () => {
	test("returns null for unknown document key", () => {
		expect(getEditorViewState("nonexistent")).toBeNull();
	});

	test("stores and retrieves cursor position", () => {
		setEditorViewState(DOC_KEY_A, { line: 42, column: 10 });

		const state = getEditorViewState(DOC_KEY_A);
		expect(state).toEqual({ line: 42, column: 10 });
	});

	test("preserves positions for different documents independently", () => {
		setEditorViewState(DOC_KEY_A, { line: 100, column: 5 });
		setEditorViewState(DOC_KEY_B, { line: 200, column: 15 });

		expect(getEditorViewState(DOC_KEY_A)).toEqual({ line: 100, column: 5 });
		expect(getEditorViewState(DOC_KEY_B)).toEqual({ line: 200, column: 15 });
	});

	test("overwrites previous position on update", () => {
		setEditorViewState(DOC_KEY_A, { line: 10, column: 1 });
		setEditorViewState(DOC_KEY_A, { line: 250, column: 30 });

		expect(getEditorViewState(DOC_KEY_A)).toEqual({ line: 250, column: 30 });
	});

	test("deleteEditorViewState removes cached position", () => {
		setEditorViewState(DOC_KEY_A, { line: 42, column: 10 });
		deleteEditorViewState(DOC_KEY_A);

		expect(getEditorViewState(DOC_KEY_A)).toBeNull();
	});

	test("simulates tab-switch cycle: save position, switch away, switch back, restore", () => {
		// User is editing file A at line 200, column 15
		setEditorViewState(DOC_KEY_A, { line: 200, column: 15 });

		// User switches to file B (file A's editor is destroyed)
		// User works on file B at line 50
		setEditorViewState(DOC_KEY_B, { line: 50, column: 1 });

		// User switches back to file A — position should be preserved
		const restoredA = getEditorViewState(DOC_KEY_A);
		expect(restoredA).toEqual({ line: 200, column: 15 });

		// File B position should also still be there
		const restoredB = getEditorViewState(DOC_KEY_B);
		expect(restoredB).toEqual({ line: 50, column: 1 });
	});
});
