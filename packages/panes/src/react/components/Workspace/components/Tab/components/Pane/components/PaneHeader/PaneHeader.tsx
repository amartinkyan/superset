import { cn } from "@superset/ui/utils";
import type { ReactNode } from "react";

interface PaneHeaderProps {
	title: ReactNode;
	icon?: ReactNode;
	isActive: boolean;
	toolbar?: ReactNode;
}

export function PaneHeader({
	title,
	icon,
	isActive,
	toolbar,
}: PaneHeaderProps) {
	const base = cn(
		"flex h-[28px] shrink-0 items-center px-2 transition-[background-color] duration-150",
		isActive ? "bg-secondary" : "bg-tertiary",
	);

	if (toolbar) {
		return <div className={base}>{toolbar}</div>;
	}

	return (
		<div className={cn(base, "gap-2")}>
			{icon && <span className="shrink-0">{icon}</span>}
			<span
				className={cn(
					"truncate text-[11px] font-medium tracking-[0.01em] transition-colors duration-150",
					isActive ? "text-foreground" : "text-muted-foreground",
				)}
			>
				{title}
			</span>
		</div>
	);
}
