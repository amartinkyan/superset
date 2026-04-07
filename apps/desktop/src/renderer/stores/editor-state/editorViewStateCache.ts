/**
 * In-memory cache for editor view state (cursor position, scroll).
 * Keyed by document key so each file/diff context gets its own saved position.
 * This cache persists across tab switches within the same session but is not
 * persisted to disk.
 */

export interface EditorViewState {
	line: number;
	column: number;
}

const viewStateCache = new Map<string, EditorViewState>();

export function getEditorViewState(
	documentKey: string,
): EditorViewState | null {
	return viewStateCache.get(documentKey) ?? null;
}

export function setEditorViewState(
	documentKey: string,
	state: EditorViewState,
): void {
	viewStateCache.set(documentKey, state);
}

export function deleteEditorViewState(documentKey: string): void {
	viewStateCache.delete(documentKey);
}
