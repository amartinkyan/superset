import { appState } from ".";
import {
	defaultAppState,
	type TabsState,
	type WindowTabsState,
} from "./schemas";

const runtimeWindowTabsState = new Map<number, WindowTabsState>();

function toWindowTabsState(
	state: Partial<TabsState> | undefined,
): WindowTabsState {
	return {
		activeTabIds: state?.activeTabIds ?? {},
		focusedPaneIds: state?.focusedPaneIds ?? {},
		tabHistoryStacks: state?.tabHistoryStacks ?? {},
	};
}

export function getTabsStateForWindow(
	windowId: number | null | undefined,
): TabsState {
	const sharedState = appState.data.tabsState ?? defaultAppState.tabsState;
	const windowState =
		(windowId !== null && windowId !== undefined
			? runtimeWindowTabsState.get(windowId)
			: undefined) ?? toWindowTabsState(sharedState);

	return {
		tabs: sharedState.tabs,
		panes: sharedState.panes,
		activeTabIds: windowState.activeTabIds,
		focusedPaneIds: windowState.focusedPaneIds,
		tabHistoryStacks: windowState.tabHistoryStacks,
	};
}

function getMergedWindowTabsState(): WindowTabsState {
	const merged = toWindowTabsState(appState.data.tabsState);

	for (const state of runtimeWindowTabsState.values()) {
		const windowState = toWindowTabsState(state);
		Object.assign(merged.activeTabIds, windowState.activeTabIds);
		Object.assign(merged.focusedPaneIds, windowState.focusedPaneIds);
		Object.assign(merged.tabHistoryStacks, windowState.tabHistoryStacks);
	}

	return merged;
}

export function setTabsStateForWindow(
	windowId: number | null | undefined,
	tabsState: TabsState,
): void {
	const windowState: WindowTabsState = {
		activeTabIds: tabsState.activeTabIds,
		focusedPaneIds: tabsState.focusedPaneIds,
		tabHistoryStacks: tabsState.tabHistoryStacks,
	};

	if (windowId !== null && windowId !== undefined) {
		runtimeWindowTabsState.set(windowId, windowState);
	}

	// Shared across windows: tab/pane topology.
	// Keep per-window view state runtime-only.
	appState.data.tabsState = {
		tabs: tabsState.tabs,
		panes: tabsState.panes,
		activeTabIds: defaultAppState.tabsState.activeTabIds,
		focusedPaneIds: defaultAppState.tabsState.focusedPaneIds,
		tabHistoryStacks: defaultAppState.tabsState.tabHistoryStacks,
	};
}

export function getMergedTabsState(): TabsState {
	const sharedState = appState.data.tabsState ?? defaultAppState.tabsState;
	const mergedWindowState = getMergedWindowTabsState();

	return {
		tabs: sharedState.tabs,
		panes: sharedState.panes,
		activeTabIds: mergedWindowState.activeTabIds,
		focusedPaneIds: mergedWindowState.focusedPaneIds,
		tabHistoryStacks: mergedWindowState.tabHistoryStacks,
	};
}

export function resetTabsState(): void {
	appState.data.tabsState = defaultAppState.tabsState;
	runtimeWindowTabsState.clear();
}

export function clearTabsStateForWindow(
	windowId: number | null | undefined,
): void {
	if (windowId === null || windowId === undefined) return;
	runtimeWindowTabsState.delete(windowId);
}
