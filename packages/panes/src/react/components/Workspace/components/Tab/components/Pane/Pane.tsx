import { useMemo } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { WorkspaceStore } from "../../../../../../../core/store";
import type { Pane as PaneType, Tab } from "../../../../../../../types";
import type { PaneRegistry, RendererContext } from "../../../../../../types";
import { PaneContent } from "./components/PaneContent";
import { PaneHeader } from "./components/PaneHeader";

interface PaneComponentProps<TData> {
	store: StoreApi<WorkspaceStore<TData>>;
	tab: Tab<TData>;
	pane: PaneType<TData>;
	isActive: boolean;
	registry: PaneRegistry<TData>;
}

export function Pane<TData>({
	store,
	tab,
	pane,
	isActive,
	registry,
}: PaneComponentProps<TData>) {
	const definition = registry[pane.kind];

	const context: RendererContext<TData> = useMemo(
		() => ({
			pane,
			tab,
			isActive,
			store,
			actions: {
				close: () =>
					store.getState().closePane({ tabId: tab.id, paneId: pane.id }),
				focus: () =>
					store.getState().setActivePane({ tabId: tab.id, paneId: pane.id }),
				setTitle: (title: string) =>
					store.getState().setPaneTitleOverride({
						tabId: tab.id,
						paneId: pane.id,
						titleOverride: title,
					}),
				pin: () =>
					store.getState().setPanePinned({
						tabId: tab.id,
						paneId: pane.id,
						pinned: true,
					}),
				updateData: (data: TData) =>
					store.getState().setPaneData({ paneId: pane.id, data }),
				splitRight: (newPane) =>
					store.getState().splitPane({
						tabId: tab.id,
						paneId: pane.id,
						position: "right",
						newPane,
					}),
				splitDown: (newPane) =>
					store.getState().splitPane({
						tabId: tab.id,
						paneId: pane.id,
						position: "bottom",
						newPane,
					}),
			},
			components: {
				DefaultContextMenuItems: () => null,
			},
		}),
		[pane, tab, isActive, store],
	);

	const title = definition
		? (pane.titleOverride ?? definition.getTitle?.(context) ?? pane.id)
		: `Unknown: ${pane.kind}`;
	const icon = definition?.getIcon?.(context);
	const toolbar = definition?.renderToolbar?.(context);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: clicking anywhere in a pane focuses it (standard IDE behavior)
		<div
			className="flex h-full w-full flex-col overflow-hidden border-[0.5px] border-border"
			onMouseDown={context.actions.focus}
		>
			<PaneHeader
				title={title}
				icon={icon}
				isActive={isActive}
				toolbar={toolbar}
			/>
			<PaneContent>
				{definition ? (
					definition.renderPane(context)
				) : (
					<div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
						Unknown pane kind: {pane.kind}
					</div>
				)}
			</PaneContent>
		</div>
	);
}
