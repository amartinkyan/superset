import type { ComponentType, ReactNode } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { WorkspaceStore } from "../core/store";
import type { Pane, Tab } from "../types";

export interface RendererContext<TData> {
	pane: Pane<TData>;
	tab: Tab<TData>;
	isActive: boolean;
	store: StoreApi<WorkspaceStore<TData>>;

	actions: {
		close: () => void;
		focus: () => void;
		setTitle: (title: string) => void;
		pin: () => void;
		updateData: (data: TData) => void;
		splitRight: (newPane: Pane<TData>) => void;
		splitDown: (newPane: Pane<TData>) => void;
	};

	components: {
		DefaultContextMenuItems: ComponentType;
	};
}

export interface PaneDefinition<TData> {
	renderPane(context: RendererContext<TData>): ReactNode;
	getTitle?(context: RendererContext<TData>): ReactNode;
	getIcon?(context: RendererContext<TData>): ReactNode;
	renderToolbar?(context: RendererContext<TData>): ReactNode;
}

export type PaneRegistry<TData> = Record<string, PaneDefinition<TData>>;

export interface WorkspaceProps<TData> {
	store: StoreApi<WorkspaceStore<TData>>;
	registry: PaneRegistry<TData>;
	className?: string;
	renderTabAccessory?: (tab: Tab<TData>) => ReactNode;
	renderEmptyState?: () => ReactNode;
	renderAddTabMenu?: () => ReactNode;
	onBeforeClosePane?: (
		pane: Pane<TData>,
		tab: Tab<TData>,
	) => boolean | Promise<boolean>;
	onBeforeCloseTab?: (tab: Tab<TData>) => boolean | Promise<boolean>;
}
