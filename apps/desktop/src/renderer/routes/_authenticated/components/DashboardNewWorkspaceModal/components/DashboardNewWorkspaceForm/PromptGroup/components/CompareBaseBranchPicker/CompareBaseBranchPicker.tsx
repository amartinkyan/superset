import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@superset/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@superset/ui/tabs";
import { useEffect, useRef, useState } from "react";
import { GoGitBranch } from "react-icons/go";
import { HiCheck, HiChevronUpDown } from "react-icons/hi2";
import { formatRelativeTime } from "renderer/lib/formatRelativeTime";
import type { BranchFilter } from "../../../hooks/useBranchContext";

interface BranchRow {
	name: string;
	lastCommitDate: number;
	isLocal: boolean;
	isRemote: boolean;
	recency: number | null;
	worktreePath: string | null;
}

interface CompareBaseBranchPickerProps {
	effectiveCompareBaseBranch: string | null;
	defaultBranch: string | null | undefined;
	isBranchesLoading: boolean;
	isBranchesError: boolean;
	branches: BranchRow[];
	branchSearch: string;
	onBranchSearchChange: (value: string) => void;
	branchFilter: BranchFilter;
	onBranchFilterChange: (filter: BranchFilter) => void;
	isFetchingNextPage: boolean;
	hasNextPage: boolean;
	onLoadMore: () => void;
	onSelectCompareBaseBranch: (branchName: string) => void;
}

export function CompareBaseBranchPicker({
	effectiveCompareBaseBranch,
	defaultBranch,
	isBranchesLoading,
	isBranchesError,
	branches,
	branchSearch,
	onBranchSearchChange,
	branchFilter,
	onBranchFilterChange,
	isFetchingNextPage,
	hasNextPage,
	onLoadMore,
	onSelectCompareBaseBranch,
}: CompareBaseBranchPickerProps) {
	const [open, setOpen] = useState(false);
	const sentinelRef = useRef<HTMLDivElement | null>(null);

	// Infinite scroll: observe a sentinel at the bottom of the list.
	useEffect(() => {
		if (!open || !hasNextPage || isFetchingNextPage) return;
		const el = sentinelRef.current;
		if (!el) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					onLoadMore();
				}
			},
			{ rootMargin: "64px" },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [open, hasNextPage, isFetchingNextPage, onLoadMore]);

	if (isBranchesError) {
		return (
			<span className="text-xs text-destructive">Failed to load branches</span>
		);
	}

	return (
		<Popover
			open={open}
			onOpenChange={(v) => {
				setOpen(v);
				if (!v) onBranchSearchChange("");
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={isBranchesLoading && branches.length === 0}
					className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 min-w-0 max-w-full"
				>
					<GoGitBranch className="size-3 shrink-0" />
					{isBranchesLoading && branches.length === 0 ? (
						<span className="h-2.5 w-14 rounded-sm bg-muted-foreground/15 animate-pulse" />
					) : (
						<span className="font-mono truncate">
							{effectiveCompareBaseBranch || "..."}
						</span>
					)}
					<HiChevronUpDown className="size-3 shrink-0" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				className="w-96 p-0"
				align="start"
				onWheel={(event) => event.stopPropagation()}
			>
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search branches..."
						value={branchSearch}
						onValueChange={onBranchSearchChange}
					/>
					<Tabs
						value={branchFilter}
						onValueChange={(v) => onBranchFilterChange(v as BranchFilter)}
						className="px-2 pt-2"
					>
						<TabsList className="grid w-full grid-cols-3 h-7">
							<TabsTrigger value="local" className="text-[11px]">
								Local
							</TabsTrigger>
							<TabsTrigger value="remote" className="text-[11px]">
								Remote
							</TabsTrigger>
							<TabsTrigger value="worktree" className="text-[11px]">
								Worktree
							</TabsTrigger>
						</TabsList>
					</Tabs>
					<CommandList className="max-h-[400px]">
						{!isBranchesLoading && branches.length === 0 && (
							<CommandEmpty>No branches found</CommandEmpty>
						)}
						{branches.map((branch) => (
							<CommandItem
								key={branch.name}
								value={branch.name}
								onSelect={() => {
									onSelectCompareBaseBranch(branch.name);
									setOpen(false);
								}}
								className="group h-11 flex items-center justify-between gap-3 px-3"
							>
								<span className="flex items-center gap-2.5 truncate flex-1 min-w-0">
									<GoGitBranch className="size-3.5 shrink-0 text-muted-foreground" />
									<span className="truncate font-mono text-xs">
										{branch.name}
									</span>
									<span className="flex items-center gap-1.5 shrink-0">
										{branch.name === defaultBranch && (
											<span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
												default
											</span>
										)}
										{branch.worktreePath && (
											<span className="text-[10px] text-muted-foreground/60 bg-muted/60 px-1.5 py-0.5 rounded">
												worktree
											</span>
										)}
									</span>
								</span>
								<span className="flex items-center gap-2 shrink-0">
									{branch.lastCommitDate > 0 && (
										<span className="text-[11px] text-muted-foreground/70">
											{formatRelativeTime(branch.lastCommitDate * 1000)}
										</span>
									)}
									{effectiveCompareBaseBranch === branch.name && (
										<HiCheck className="size-4 text-primary" />
									)}
								</span>
							</CommandItem>
						))}
						{hasNextPage && (
							<div
								ref={sentinelRef}
								className="py-2 text-center text-[11px] text-muted-foreground/60"
							>
								{isFetchingNextPage ? "Loading more..." : ""}
							</div>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
