import { useEffect, useMemo } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useTabsStore } from "renderer/stores/tabs/store";
import {
	APP_NAME,
	DEFAULT_WINDOW_TITLE_FORMAT,
	formatWindowTitle,
} from "shared/window-title";

interface UseWindowTitleOptions {
	workspaceId: string;
	workspaceDisplayName?: string;
	branch?: string | null;
}

/**
 * Reactively updates the Electron window title based on the current
 * workspace, active tab, and focused pane.
 */
export function useWindowTitle({
	workspaceId,
	workspaceDisplayName,
	branch,
}: UseWindowTitleOptions) {
	const { data: titleFormat } =
		electronTrpc.settings.getWindowTitleFormat.useQuery();
	const setTitleMutation = electronTrpc.window.setTitle.useMutation();

	const activeTabId = useTabsStore((s) => s.activeTabIds[workspaceId] ?? null);
	const tabs = useTabsStore((s) => s.tabs);
	const panes = useTabsStore((s) => s.panes);
	const focusedPaneIds = useTabsStore((s) => s.focusedPaneIds);

	const activeTab = useMemo(
		() => tabs.find((t) => t.id === activeTabId),
		[tabs, activeTabId],
	);

	const focusedPaneId = activeTabId
		? (focusedPaneIds[activeTabId] ?? null)
		: null;
	const focusedPane = focusedPaneId ? (panes[focusedPaneId] ?? null) : null;

	const tabName = activeTab?.userTitle || activeTab?.name || "";
	const paneName =
		focusedPane?.userTitle || focusedPane?.cwd || focusedPane?.name || "";

	const format = titleFormat ?? DEFAULT_WINDOW_TITLE_FORMAT;

	const title = useMemo(
		() =>
			formatWindowTitle(format, {
				workspace: workspaceDisplayName ?? "",
				branch: branch ?? "",
				tab: tabName,
				pane: paneName,
				appName: APP_NAME,
			}),
		[format, workspaceDisplayName, branch, tabName, paneName],
	);

	useEffect(() => {
		setTitleMutation.mutate({ title });
	}, [title, setTitleMutation.mutate]); // eslint-disable-line react-hooks/exhaustive-deps
}
