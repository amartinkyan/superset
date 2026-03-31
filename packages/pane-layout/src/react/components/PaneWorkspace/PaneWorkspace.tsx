import { cn } from "@superset/ui/lib/utils";
import { usePaneWorkspaceStore } from "../../hooks";
import type { PaneWorkspaceProps } from "../../types";
import { PaneRootTabs } from "./components/PaneRootTabs";
import { PaneRootView } from "./components/PaneRootView";

export function PaneWorkspace<TPaneData>({
	store,
	registry,
	className,
	getRootTitle,
	onAddRoot,
	renderAddRootMenu,
	onAddPane,
	renderEmptyState,
	renderUnknownPane,
}: PaneWorkspaceProps<TPaneData>) {
	const roots = usePaneWorkspaceStore(store, (state) => state.state.roots);
	const activeRootId = usePaneWorkspaceStore(
		store,
		(state) => state.state.activeRootId,
	);
	const effectiveActiveRootId = activeRootId ?? roots[0]?.id ?? null;

	return (
		<div
			className={cn(
				"flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-background text-foreground shadow-xs",
				className,
			)}
		>
			<PaneRootTabs
				activeRootId={activeRootId}
				getRootTitle={getRootTitle}
				onAddRoot={onAddRoot}
				renderAddRootMenu={renderAddRootMenu}
				onSelectRoot={(rootId) => store.getState().setActiveRoot(rootId)}
				roots={roots}
				store={store}
			/>
			{roots.length === 0 ? (
				<PaneRootView
					registry={registry}
					onAddPane={onAddPane}
					renderEmptyState={renderEmptyState}
					renderUnknownPane={renderUnknownPane}
					root={null}
					store={store}
				/>
			) : (
				roots.map((root) => {
					const isActive = root.id === effectiveActiveRootId;
					return (
						<div
							className={
								isActive
									? "flex min-h-0 min-w-0 flex-1 overflow-hidden"
									: "invisible absolute size-0 overflow-hidden"
							}
							key={root.id}
						>
							<PaneRootView
								registry={registry}
								onAddPane={onAddPane}
								renderEmptyState={renderEmptyState}
								renderUnknownPane={renderUnknownPane}
								root={root}
								store={store}
							/>
						</div>
					);
				})
			)}
		</div>
	);
}
