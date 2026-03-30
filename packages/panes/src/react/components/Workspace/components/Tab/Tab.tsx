import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@superset/ui/resizable";
import type { StoreApi } from "zustand/vanilla";
import type { WorkspaceStore } from "../../../../../core/store";
import type { LayoutNode, Tab as TabType } from "../../../../../types";
import type { PaneRegistry } from "../../../../types";
import { Pane } from "./components/Pane";

interface TabProps<TData> {
	store: StoreApi<WorkspaceStore<TData>>;
	tab: TabType<TData>;
	registry: PaneRegistry<TData>;
}

function weightsToPercentages(weights: number[]): number[] {
	const total = weights.reduce((sum, w) => sum + w, 0);
	if (total === 0) return weights.map(() => 100 / weights.length);
	return weights.map((w) => (w / total) * 100);
}

function LayoutNodeView<TData>({
	store,
	tab,
	node,
	registry,
}: {
	store: StoreApi<WorkspaceStore<TData>>;
	tab: TabType<TData>;
	node: LayoutNode;
	registry: PaneRegistry<TData>;
}) {
	if (node.type === "pane") {
		const pane = tab.panes[node.paneId];
		if (!pane) return null;

		return (
			<Pane
				store={store}
				tab={tab}
				pane={pane}
				isActive={tab.activePaneId === pane.id}
				registry={registry}
			/>
		);
	}

	const percentages = weightsToPercentages(node.weights);

	return (
		<ResizablePanelGroup
			direction={node.direction}
			onLayout={(sizes) => {
				store.getState().resizeSplit({
					tabId: tab.id,
					splitId: node.id,
					weights: sizes,
				});
			}}
		>
			{node.children.map((child, index) => {
				const key = child.type === "pane" ? child.paneId : child.id;
				return (
					<>
						{index > 0 && <ResizableHandle key={`handle-${key}`} />}
						<ResizablePanel key={key} defaultSize={percentages[index]}>
							<LayoutNodeView
								store={store}
								tab={tab}
								node={child}
								registry={registry}
							/>
						</ResizablePanel>
					</>
				);
			})}
		</ResizablePanelGroup>
	);
}

export function Tab<TData>({ store, tab, registry }: TabProps<TData>) {
	if (!tab.layout) {
		return (
			<div className="flex min-h-0 min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground">
				No panes open
			</div>
		);
	}

	return (
		<div className="flex h-full w-full min-h-0 min-w-0 overflow-hidden">
			<LayoutNodeView
				store={store}
				tab={tab}
				node={tab.layout}
				registry={registry}
			/>
		</div>
	);
}
