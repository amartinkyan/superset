import { PROJECT_COLOR_DEFAULT } from "shared/constants/project-colors";
import type {
	DashboardSidebarSection,
	DashboardSidebarWorkspace,
} from "../../types";
import { DashboardSidebarWorkspaceItem } from "../DashboardSidebarWorkspaceItem";

type ActiveItem =
	| { type: "workspace"; workspace: DashboardSidebarWorkspace }
	| { type: "section"; section: DashboardSidebarSection };

interface SidebarDragOverlayProps {
	activeItem: ActiveItem | null;
}

export function SidebarDragOverlay({ activeItem }: SidebarDragOverlayProps) {
	if (!activeItem) return null;

	if (activeItem.type === "workspace") {
		return (
			<div className="bg-background shadow-lg">
				<DashboardSidebarWorkspaceItem workspace={activeItem.workspace} />
			</div>
		);
	}

	const { section } = activeItem;
	const hasColor =
		section.color != null && section.color !== PROJECT_COLOR_DEFAULT;

	return (
		<div className="bg-background shadow-lg">
			<div className="flex min-h-7 w-full items-center gap-1.5 px-1 py-1 text-[11px] font-medium text-muted-foreground">
				<div className="h-px flex-1 bg-border" />
				<div className="flex shrink-0 items-center gap-1.5">
					{hasColor && (
						<span
							className="size-2 shrink-0 rounded-full"
							style={{ backgroundColor: section.color! }}
						/>
					)}
					<span className="truncate">{section.name}</span>
					<span className="text-[10px] font-normal tabular-nums shrink-0">
						({section.workspaces.length})
					</span>
				</div>
				<div className="h-px flex-1 bg-border" />
			</div>
		</div>
	);
}
