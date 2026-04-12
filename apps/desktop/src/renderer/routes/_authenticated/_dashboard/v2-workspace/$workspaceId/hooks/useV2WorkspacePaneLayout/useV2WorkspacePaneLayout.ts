import { createWorkspaceStore, type WorkspaceState } from "@superset/panes";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDashboardSidebarState } from "renderer/routes/_authenticated/hooks/useDashboardSidebarState";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import type { PaneViewerData } from "../../types";

const EMPTY_STATE: WorkspaceState<PaneViewerData> = {
	version: 1,
	tabs: [],
	activeTabId: null,
};

function getSnapshot(state: WorkspaceState<PaneViewerData>): string {
	return JSON.stringify(state);
}

interface UseV2WorkspacePaneLayoutParams {
	projectId: string;
	workspaceId: string;
}

export function useV2WorkspacePaneLayout({
	projectId,
	workspaceId,
}: UseV2WorkspacePaneLayoutParams) {
	const collections = useCollections();
	const { ensureWorkspaceInSidebar } = useDashboardSidebarState();
	const [store] = useState(() =>
		createWorkspaceStore<PaneViewerData>({
			initialState: EMPTY_STATE,
		}),
	);
	const lastSyncedSnapshotRef = useRef(getSnapshot(EMPTY_STATE));

	const { data: localWorkspaceRows = [] } = useLiveQuery(
		(query) =>
			query
				.from({ v2WorkspaceLocalState: collections.v2WorkspaceLocalState })
				.where(({ v2WorkspaceLocalState }) =>
					eq(v2WorkspaceLocalState.workspaceId, workspaceId),
				),
		[collections, workspaceId],
	);
	const localWorkspaceState = localWorkspaceRows[0] ?? null;
	const persistedPaneLayout = useMemo(
		() =>
			(localWorkspaceState?.paneLayout as
				| WorkspaceState<PaneViewerData>
				| undefined) ?? EMPTY_STATE,
		[localWorkspaceState],
	);

	useEffect(() => {
		ensureWorkspaceInSidebar(workspaceId, projectId);
	}, [ensureWorkspaceInSidebar, projectId, workspaceId]);

	useEffect(() => {
		const nextSnapshot = getSnapshot(persistedPaneLayout);
		if (nextSnapshot === lastSyncedSnapshotRef.current) {
			return;
		}

		lastSyncedSnapshotRef.current = nextSnapshot;
		store.getState().replaceState(persistedPaneLayout);
	}, [persistedPaneLayout, store]);

	const pendingLayoutRef = useRef<WorkspaceState<PaneViewerData> | null>(null);

	// Flush any queued layout update once the local state record appears
	useEffect(() => {
		if (!localWorkspaceState || !pendingLayoutRef.current) return;
		const pending = pendingLayoutRef.current;
		pendingLayoutRef.current = null;
		collections.v2WorkspaceLocalState.update(workspaceId, (draft) => {
			draft.paneLayout = pending;
		});
		lastSyncedSnapshotRef.current = getSnapshot(pending);
	}, [localWorkspaceState, collections, workspaceId]);

	useEffect(() => {
		const unsubscribe = store.subscribe((nextStore) => {
			const layout = {
				version: nextStore.version,
				tabs: nextStore.tabs,
				activeTabId: nextStore.activeTabId,
			};
			const nextSnapshot = getSnapshot(layout);
			if (nextSnapshot === lastSyncedSnapshotRef.current) {
				return;
			}

			ensureWorkspaceInSidebar(workspaceId, projectId);
			if (!collections.v2WorkspaceLocalState.get(workspaceId)) {
				pendingLayoutRef.current = layout;
				return;
			}

			collections.v2WorkspaceLocalState.update(workspaceId, (draft) => {
				draft.paneLayout = layout;
			});
			lastSyncedSnapshotRef.current = nextSnapshot;
		});

		return () => {
			unsubscribe();
		};
	}, [collections, ensureWorkspaceInSidebar, projectId, store, workspaceId]);

	return {
		localWorkspaceState,
		store,
	};
}
