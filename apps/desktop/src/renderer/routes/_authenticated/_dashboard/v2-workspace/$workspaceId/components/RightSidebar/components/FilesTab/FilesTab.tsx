import { Button } from "@superset/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import {
	type FileTreeNode,
	useFileTree,
	useWorkspaceFsEventBridge,
	useWorkspaceFsEvents,
	workspaceTrpc,
} from "@superset/workspace-client";
import { FilePlus, FolderPlus, RefreshCw, Shrink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	ROW_HEIGHT,
	TREE_INDENT,
} from "renderer/screens/main/components/WorkspaceView/RightSidebar/FilesView/constants";
import { WorkspaceFilesTreeItem } from "./components/WorkspaceFilesTreeItem";

interface FilesTabProps {
	onSelectFile: (absolutePath: string) => void;
	selectedFilePath?: string;
	workspaceId: string;
	workspaceName?: string;
}

function TreeNode({
	node,
	depth,
	indent,
	rowHeight,
	selectedFilePath,
	hoveredPath,
	onSelectFile,
	onToggleDirectory,
}: {
	node: FileTreeNode;
	depth: number;
	indent: number;
	rowHeight: number;
	selectedFilePath?: string;
	hoveredPath?: string | null;
	onSelectFile: (absolutePath: string) => void;
	onToggleDirectory: (absolutePath: string) => void;
}) {
	return (
		<div>
			<WorkspaceFilesTreeItem
				node={node}
				depth={depth}
				indent={indent}
				rowHeight={rowHeight}
				selectedFilePath={selectedFilePath}
				isHovered={hoveredPath === node.absolutePath}
				onSelectFile={onSelectFile}
				onToggleDirectory={onToggleDirectory}
			/>
			{node.kind === "directory" &&
				node.isExpanded &&
				node.children.map((child) => (
					<TreeNode
						key={child.absolutePath}
						node={child}
						depth={depth + 1}
						indent={indent}
						rowHeight={rowHeight}
						selectedFilePath={selectedFilePath}
						hoveredPath={hoveredPath}
						onSelectFile={onSelectFile}
						onToggleDirectory={onToggleDirectory}
					/>
				))}
		</div>
	);
}

export function FilesTab({
	onSelectFile,
	selectedFilePath,
	workspaceId,
	workspaceName,
}: FilesTabProps) {
	const [_isRefreshing, setIsRefreshing] = useState(false);
	const [hoveredPath, setHoveredPath] = useState<string | null>(null);
	const utils = workspaceTrpc.useUtils();
	const workspaceQuery = workspaceTrpc.workspace.get.useQuery({
		id: workspaceId,
	});
	const rootPath = workspaceQuery.data?.worktreePath ?? "";

	useWorkspaceFsEventBridge(
		workspaceId,
		Boolean(workspaceId && workspaceQuery.data?.worktreePath),
	);

	const fileTree = useFileTree({
		workspaceId,
		rootPath,
	});

	useWorkspaceFsEvents(
		workspaceId,
		() => {
			void utils.filesystem.searchFiles.invalidate();
		},
		Boolean(workspaceId),
	);

	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const lastMousePos = useRef<{ x: number; y: number } | null>(null);
	const prevSelectedRef = useRef(selectedFilePath);

	const updateHoverFromPoint = useCallback((x: number, y: number) => {
		const el = document.elementFromPoint(x, y)?.closest("[data-filepath]");
		setHoveredPath(el?.getAttribute("data-filepath") ?? null);
	}, []);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent) => {
			lastMousePos.current = { x: e.clientX, y: e.clientY };
			updateHoverFromPoint(e.clientX, e.clientY);
		},
		[updateHoverFromPoint],
	);

	const handleScroll = useCallback(() => {
		if (lastMousePos.current) {
			updateHoverFromPoint(lastMousePos.current.x, lastMousePos.current.y);
		}
	}, [updateHoverFromPoint]);

	const handleMouseLeave = useCallback(() => {
		lastMousePos.current = null;
		setHoveredPath(null);
	}, []);

	useEffect(() => {
		if (
			selectedFilePath &&
			selectedFilePath !== prevSelectedRef.current &&
			rootPath
		) {
			void fileTree.reveal(selectedFilePath).then(() => {
				requestAnimationFrame(() => {
					const el = scrollContainerRef.current?.querySelector(
						`[data-filepath="${CSS.escape(selectedFilePath)}"]`,
					);
					el?.scrollIntoView({ block: "center" });
				});
			});
		}
		prevSelectedRef.current = selectedFilePath;
	}, [selectedFilePath, rootPath, fileTree]);

	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true);
		try {
			await fileTree.refreshAll();
		} finally {
			setIsRefreshing(false);
		}
	}, [fileTree]);

	if (workspaceQuery.isPending) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Loading workspace files...
			</div>
		);
	}

	if (!workspaceQuery.data?.worktreePath) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Workspace worktree not available
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: mouse tracking for hover state, not interactive */}
			<div
				ref={scrollContainerRef}
				className="min-h-0 flex-1 overflow-y-auto"
				onMouseMove={handleMouseMove}
				onMouseLeave={handleMouseLeave}
				onScroll={handleScroll}
			>
				{/* Workspace root — sticky, not collapsible */}
				<div
					className="group flex items-center justify-between bg-background px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
					style={{
						height: ROW_HEIGHT,
						position: "sticky",
						top: 0,
						zIndex: 20,
					}}
				>
					<span className="truncate">{workspaceName ?? "Explorer"}</span>
					<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="size-5">
									<FilePlus className="size-3" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">New File</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="size-5">
									<FolderPlus className="size-3" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">New Folder</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="size-5"
									onClick={() => void handleRefresh()}
								>
									<RefreshCw className="size-3" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">Refresh</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="size-5"
									onClick={fileTree.collapseAll}
								>
									<Shrink className="size-3" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">Collapse All</TooltipContent>
						</Tooltip>
					</div>
				</div>

				{/* Tree — recursive nested rendering */}
				{fileTree.isLoadingRoot && fileTree.rootEntries.length === 0 ? (
					<div className="px-2 py-3 text-sm text-muted-foreground">
						Loading files...
					</div>
				) : fileTree.rootEntries.length === 0 ? (
					<div className="px-2 py-3 text-sm text-muted-foreground">
						No files found
					</div>
				) : (
					fileTree.rootEntries.map((node) => (
						<TreeNode
							key={node.absolutePath}
							node={node}
							depth={1}
							indent={TREE_INDENT}
							rowHeight={ROW_HEIGHT}
							selectedFilePath={selectedFilePath}
							hoveredPath={hoveredPath}
							onSelectFile={onSelectFile}
							onToggleDirectory={(absolutePath) =>
								void fileTree.toggle(absolutePath)
							}
						/>
					))
				)}
			</div>
		</div>
	);
}
