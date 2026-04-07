import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DashboardSidebarWorkspace } from "../../types";
import { DashboardSidebarWorkspaceItem } from "../DashboardSidebarWorkspaceItem";

interface SortableWorkspaceItemProps {
	sortableId: string;
	workspace: DashboardSidebarWorkspace;
	accentColor?: string | null;
	onHoverCardOpen?: () => void;
	shortcutLabel?: string;
}

export function SortableWorkspaceItem({
	sortableId,
	workspace,
	accentColor,
	onHoverCardOpen,
	shortcutLabel,
}: SortableWorkspaceItemProps) {
	const { setNodeRef, listeners, isDragging, transform, transition } =
		useSortable({ id: sortableId });

	return (
		<div
			ref={setNodeRef}
			style={{
				transform: CSS.Translate.toString(transform),
				transition,
				opacity: isDragging ? 0.5 : undefined,
				borderLeft: accentColor ? `2px solid ${accentColor}` : undefined,
			}}
			{...listeners}
		>
			<DashboardSidebarWorkspaceItem
				workspace={workspace}
				onHoverCardOpen={onHoverCardOpen}
				shortcutLabel={shortcutLabel}
			/>
		</div>
	);
}
