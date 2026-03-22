export interface SidebarWorkspace {
	id: string;
	projectId: string;
	worktreePath: string;
	existsOnDisk: boolean;
	type: "worktree" | "branch";
	branch: string;
	name: string;
	tabOrder: number;
	isUnread: boolean;
	repairCommand?: string | null;
	repairMessage?: string | null;
	repairState?: "ok" | "missing" | "repair_required" | "repairing";
}

export interface DragItem {
	kind: "workspace";
	id: string;
	projectId: string;
	sectionId: string | null;
	index: number;
	originalIndex: number;
	/** Set by native drop handlers to prevent the end handler from reordering */
	handled?: boolean;
	/** IDs of all selected workspaces when multi-dragging */
	selectedIds?: string[];
}

export interface SectionDragItem {
	kind: "section";
	sectionId: string;
	projectId: string;
	index: number;
	originalIndex: number;
}

export interface SidebarSection {
	id: string;
	projectId?: string;
	name: string;
	tabOrder: number;
	isCollapsed: boolean;
	color: string | null;
	workspaces: SidebarWorkspace[];
}
