import { ContextMenu, ContextMenuTrigger } from "@superset/ui/context-menu";
import { cn } from "@superset/ui/utils";
import type { FileTreeNode } from "@superset/workspace-client";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { FileIcon } from "renderer/screens/main/components/WorkspaceView/RightSidebar/FilesView/utils";
import { FileContextMenu } from "./components/FileContextMenu";
import { FolderContextMenu } from "./components/FolderContextMenu";

interface WorkspaceFilesTreeItemProps {
	node: FileTreeNode;
	depth: number;
	rowHeight: number;
	indent: number;
	selectedFilePath?: string;
	isHovered?: boolean;
	onSelectFile: (absolutePath: string) => void;
	onToggleDirectory: (absolutePath: string) => void;
}

export function WorkspaceFilesTreeItem({
	node,
	depth,
	rowHeight,
	indent,
	selectedFilePath,
	isHovered,
	onSelectFile,
	onToggleDirectory,
}: WorkspaceFilesTreeItemProps) {
	const isFolder = node.kind === "directory";
	const isSelected = selectedFilePath === node.absolutePath;

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<button
					data-filepath={node.absolutePath}
					aria-expanded={isFolder ? node.isExpanded : undefined}
					className={cn(
						"flex w-full cursor-pointer select-none items-center gap-1 px-1 text-left transition-colors",
						isFolder ? "bg-background" : undefined,
						isHovered && !isSelected ? "!bg-accent/50" : undefined,
						isSelected ? "!bg-accent" : undefined,
					)}
					onClick={() =>
						isFolder
							? onToggleDirectory(node.absolutePath)
							: onSelectFile(node.absolutePath)
					}
					style={{
						height: rowHeight,
						paddingLeft: 4 + depth * indent,
						...(isFolder
							? {
									position: "sticky" as const,
									top: depth * rowHeight,
									zIndex: 10 - depth,
								}
							: {}),
					}}
					type="button"
				>
					<span className="flex h-4 w-4 shrink-0 items-center justify-center">
						{isFolder ? (
							node.isExpanded ? (
								<LuChevronDown className="size-3.5 text-muted-foreground" />
							) : (
								<LuChevronRight className="size-3.5 text-muted-foreground" />
							)
						) : null}
					</span>

					<FileIcon
						className="size-4 shrink-0"
						fileName={node.name}
						isDirectory={isFolder}
						isOpen={node.isExpanded}
					/>

					<span className="min-w-0 flex-1 truncate text-xs">{node.name}</span>
				</button>
			</ContextMenuTrigger>
			{isFolder ? <FolderContextMenu /> : <FileContextMenu />}
		</ContextMenu>
	);
}
