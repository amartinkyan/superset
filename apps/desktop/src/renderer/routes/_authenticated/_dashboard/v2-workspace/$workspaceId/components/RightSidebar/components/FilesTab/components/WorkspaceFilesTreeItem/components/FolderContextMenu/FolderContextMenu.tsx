import {
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
} from "@superset/ui/context-menu";

export function FolderContextMenu() {
	return (
		<ContextMenuContent className="w-56">
			<ContextMenuItem>New File...</ContextMenuItem>
			<ContextMenuItem>New Folder...</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem>
				Reveal in Finder
				<ContextMenuShortcut>⌥⌘R</ContextMenuShortcut>
			</ContextMenuItem>
			<ContextMenuItem>Open in Integrated Terminal</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem>
				Copy Path
				<ContextMenuShortcut>⌥⌘C</ContextMenuShortcut>
			</ContextMenuItem>
			<ContextMenuItem>
				Copy Relative Path
				<ContextMenuShortcut>⌥⇧⌘C</ContextMenuShortcut>
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem>
				Rename...
				<ContextMenuShortcut>↵</ContextMenuShortcut>
			</ContextMenuItem>
			<ContextMenuItem className="text-destructive focus:text-destructive">
				Delete
				<ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
			</ContextMenuItem>
		</ContextMenuContent>
	);
}
