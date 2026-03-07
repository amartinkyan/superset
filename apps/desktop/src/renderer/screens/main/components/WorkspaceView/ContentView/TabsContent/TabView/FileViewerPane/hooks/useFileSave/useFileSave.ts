import { isAbsolute, relative, resolve } from "pathe";
import { type MutableRefObject, useCallback, useMemo, useRef } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useTabsStore } from "renderer/stores/tabs/store";
import type { ChangeCategory } from "shared/changes-types";
import type { CodeEditorAdapter } from "../../../../../components";

interface UseFileSaveParams {
	worktreePath: string;
	/** Absolute file path */
	filePath: string;
	paneId: string;
	diffCategory?: ChangeCategory;
	editorRef: MutableRefObject<CodeEditorAdapter | null>;
	originalContentRef: MutableRefObject<string>;
	originalDiffContentRef: MutableRefObject<string>;
	draftContentRef: MutableRefObject<string | null>;
	setIsDirty: (dirty: boolean) => void;
}

export function useFileSave({
	worktreePath,
	filePath,
	paneId,
	diffCategory,
	editorRef,
	originalContentRef,
	originalDiffContentRef,
	draftContentRef,
	setIsDirty,
}: UseFileSaveParams) {
	// Derive worktree-relative path for secureFs save operations.
	// Returns null for external files (outside worktree) — save is disabled.
	const relativeFilePath = useMemo(() => {
		if (!worktreePath) return null;
		const abs = isAbsolute(filePath)
			? filePath
			: resolve(worktreePath, filePath);
		const rel = relative(worktreePath, abs);
		return rel.startsWith("..") ? null : rel;
	}, [worktreePath, filePath]);
	const savingFromRawRef = useRef(false);
	const utils = electronTrpc.useUtils();

	const saveFileMutation = electronTrpc.changes.saveFile.useMutation({
		onSuccess: () => {
			setIsDirty(false);
			if (editorRef.current) {
				originalContentRef.current = editorRef.current.getValue();
			}
			if (savingFromRawRef.current) {
				draftContentRef.current = null;
			}
			savingFromRawRef.current = false;
			originalDiffContentRef.current = "";

			utils.changes.readWorkingFile.invalidate();
			utils.changes.getFileContents.invalidate();
			utils.changes.getStatus.invalidate();

			if (diffCategory === "staged") {
				const panes = useTabsStore.getState().panes;
				const currentPane = panes[paneId];
				if (currentPane?.fileViewer) {
					useTabsStore.setState({
						panes: {
							...panes,
							[paneId]: {
								...currentPane,
								fileViewer: {
									...currentPane.fileViewer,
									diffCategory: "unstaged",
								},
							},
						},
					});
				}
			}
		},
	});

	const handleSaveRaw = useCallback(async () => {
		if (!editorRef.current || !relativeFilePath || !worktreePath) return;
		savingFromRawRef.current = true;
		await saveFileMutation.mutateAsync({
			worktreePath,
			filePath: relativeFilePath,
			content: editorRef.current.getValue(),
		});
	}, [worktreePath, relativeFilePath, saveFileMutation, editorRef]);

	return {
		handleSaveRaw,
		isSaving: saveFileMutation.isPending,
	};
}
