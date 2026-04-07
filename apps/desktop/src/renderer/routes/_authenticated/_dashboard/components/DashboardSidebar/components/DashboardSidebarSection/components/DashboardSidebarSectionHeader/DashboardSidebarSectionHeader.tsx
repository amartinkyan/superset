import { cn } from "@superset/ui/utils";
import { type ComponentPropsWithoutRef, forwardRef } from "react";
import { HiChevronRight } from "react-icons/hi2";
import { LuGripVertical, LuPencil } from "react-icons/lu";
import { RenameInput } from "renderer/screens/main/components/WorkspaceSidebar/RenameInput";
import type { DashboardSidebarSection } from "../../../../types";

interface DashboardSidebarSectionHeaderProps
	extends ComponentPropsWithoutRef<"div"> {
	section: DashboardSidebarSection;
	isRenaming: boolean;
	renameValue: string;
	onRenameValueChange: (value: string) => void;
	onSubmitRename: () => void;
	onCancelRename: () => void;
	onStartRename: () => void;
	onToggleCollapse: () => void;
}

export const DashboardSidebarSectionHeader = forwardRef<
	HTMLDivElement,
	DashboardSidebarSectionHeaderProps
>(
	(
		{
			section,
			isRenaming,
			renameValue,
			onRenameValueChange,
			onSubmitRename,
			onCancelRename,
			onStartRename,
			onToggleCollapse,
			className,
			...props
		},
		ref,
	) => {
		const sectionColor = section.color;

		return (
			// biome-ignore lint/a11y/noStaticElementInteractions: The header acts as a single toggle target in view mode while preserving nested inline controls.
			<div
				ref={ref}
				role={isRenaming ? undefined : "button"}
				tabIndex={isRenaming ? undefined : 0}
				onClick={isRenaming ? undefined : onToggleCollapse}
				onKeyDown={
					isRenaming
						? undefined
						: (event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									onToggleCollapse();
								}
							}
				}
				className={cn(
					"group flex min-h-7 w-full items-center gap-1.5 px-1 py-1 text-[11px] font-medium",
					"text-muted-foreground hover:bg-muted/50 transition-colors",
					className,
				)}
				{...props}
			>
				<LuGripVertical className="size-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity cursor-grab active:cursor-grabbing" />

				<div className="h-px flex-1 bg-border" />

				{sectionColor && (
					<span
						className="size-2 shrink-0 rounded-full"
						style={{ backgroundColor: sectionColor }}
					/>
				)}

				{isRenaming ? (
					<div
						className="shrink min-w-0"
						style={{ width: `${Math.max(renameValue.length + 1, 3)}ch` }}
					>
						<RenameInput
							value={renameValue}
							onChange={onRenameValueChange}
							onSubmit={onSubmitRename}
							onCancel={onCancelRename}
							className="h-5 w-full py-0 text-[11px] font-medium text-center bg-transparent border-none outline-none text-muted-foreground"
						/>
					</div>
				) : (
					<span className="shrink-0 truncate">{section.name}</span>
				)}

				<div className={cn("grid shrink-0 items-center [&>*]:col-start-1 [&>*]:row-start-1", isRenaming && "invisible")}>
					<span className="pointer-events-none text-[10px] font-normal tabular-nums transition-opacity duration-150 group-hover:opacity-0">
						({section.workspaces.length})
					</span>
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							onStartRename();
						}}
						className="flex items-center justify-center opacity-0 text-muted-foreground transition-[opacity,color] duration-150 group-hover:opacity-100 hover:text-foreground"
						aria-label="Rename section"
					>
						<LuPencil className="size-3.5" />
					</button>
				</div>

				<div className="h-px flex-1 bg-border" />

				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onToggleCollapse();
					}}
					onContextMenu={(event) => event.stopPropagation()}
					aria-expanded={!section.isCollapsed}
					className="p-0.5 rounded hover:bg-muted transition-colors shrink-0"
				>
					<HiChevronRight
						className={cn(
							"size-3 text-muted-foreground transition-transform duration-150",
							!section.isCollapsed && "rotate-90",
						)}
					/>
				</button>
			</div>
		);
	},
);
