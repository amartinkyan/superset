import {
	PromptInputButton,
	usePromptInputController,
} from "@superset/ui/ai-elements/prompt-input";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@superset/ui/command";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
	PopoverTrigger,
} from "@superset/ui/popover";
import { workspaceTrpc } from "@superset/workspace-client";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { HiMiniAtSymbol } from "react-icons/hi2";
import { useDebouncedValue } from "renderer/hooks/useDebouncedValue";
import { FileIcon } from "renderer/screens/main/components/WorkspaceView/RightSidebar/FilesView/utils";

function findAtTriggerIndex(value: string, prevValue: string): number {
	if (value.length !== prevValue.length + 1) return -1;
	for (let i = 0; i < value.length; i++) {
		if (value[i] !== prevValue[i]) {
			if (value[i] !== "@") return -1;
			const charBefore = value[i - 1];
			if (
				charBefore === undefined ||
				charBefore === " " ||
				charBefore === "\n"
			) {
				return i;
			}
			return -1;
		}
	}
	return -1;
}

function getDirectoryPath(relativePath: string): string {
	const lastSlash = relativePath.lastIndexOf("/");
	if (lastSlash === -1) return "";
	return relativePath.slice(0, lastSlash);
}

interface MentionContextValue {
	open: boolean;
	setOpen: (open: boolean) => void;
}

const MentionContext = createContext<MentionContextValue | null>(null);

const MAX_RESULTS = 20;

export function MentionProvider({
	cwd,
	workspaceId,
	children,
}: {
	cwd: string;
	workspaceId: string;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [triggerIndex, setTriggerIndex] = useState(-1);
	const { textInput } = usePromptInputController();
	const prevValueRef = useRef(textInput.value);

	useEffect(() => {
		const prev = prevValueRef.current;
		prevValueRef.current = textInput.value;
		const idx = findAtTriggerIndex(textInput.value, prev);
		if (idx !== -1) {
			setTriggerIndex(idx);
			setSearchQuery("");
			setOpen(true);
		}
	}, [textInput.value]);

	const immediateSearchQuery = searchQuery.trim();
	const debouncedSearchQuery = useDebouncedValue(immediateSearchQuery, 120);
	const [browsingPath, setBrowsingPath] = useState("");
	const isSearching = immediateSearchQuery.length > 0;

	// Directory listing when not searching (initial view or browsing a folder)
	const absoluteBrowsePath = cwd
		? browsingPath
			? `${cwd}/${browsingPath}`
			: cwd
		: "";
	const { data: dirResults, isFetching: isDirFetching } =
		workspaceTrpc.filesystem.listDirectory.useQuery(
			{ workspaceId, absolutePath: absoluteBrowsePath },
			{
				enabled: open && !isSearching && !!cwd,
				staleTime: 10_000,
			},
		);

	// File search when user types a query
	const { data: fileResults, isFetching: isSearchFetching } =
		workspaceTrpc.filesystem.searchFiles.useQuery(
			{
				workspaceId,
				query: debouncedSearchQuery,
				includeHidden: false,
				limit: MAX_RESULTS,
			},
			{
				enabled:
					open && isSearching && debouncedSearchQuery.length > 0 && !!cwd,
				staleTime: 5_000,
			},
		);

	const dirEntries = (dirResults?.entries ?? [])
		.filter((e) => !e.name.startsWith("."))
		.sort((a, b) => {
			if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
			return a.name.localeCompare(b.name);
		})
		.slice(0, MAX_RESULTS)
		.map((entry) => ({
			id: entry.absolutePath,
			name: entry.name,
			relativePath: browsingPath ? `${browsingPath}/${entry.name}` : entry.name,
			isDirectory: entry.kind === "directory",
		}));

	const searchEntries = (fileResults?.matches ?? []).map((match) => ({
		id: match.relativePath,
		name: match.name,
		relativePath: match.relativePath,
		isDirectory: false,
	}));

	const files = isSearching ? searchEntries : dirEntries;
	const isSearchPending =
		(isSearching && !!cwd && immediateSearchQuery !== debouncedSearchQuery) ||
		isSearchFetching ||
		isDirFetching;

	const handleSelectEntry = (relativePath: string, isDirectory: boolean) => {
		if (isDirectory) {
			setBrowsingPath(relativePath);
			setSearchQuery("");
			return;
		}

		// Insert @path as plain text in the textarea
		const current = textInput.value;
		const before = current.slice(0, triggerIndex);
		const after = current.slice(triggerIndex + 1);
		textInput.setInput(`${before}@${relativePath} ${after}`.trimEnd());

		setTriggerIndex(-1);
		setBrowsingPath("");
		setOpen(false);
		requestAnimationFrame(() => textInput.focus());
	};

	const handleGoUp = () => {
		const lastSlash = browsingPath.lastIndexOf("/");
		setBrowsingPath(lastSlash === -1 ? "" : browsingPath.slice(0, lastSlash));
		setSearchQuery("");
	};

	const handleOpenChange = (nextOpen: boolean) => {
		if (nextOpen) {
			setSearchQuery("");
			setBrowsingPath("");
		}
		setOpen(nextOpen);
	};

	return (
		<MentionContext.Provider value={{ open, setOpen }}>
			<Popover open={open} onOpenChange={handleOpenChange}>
				{children}
				<PopoverContent
					side="top"
					align="start"
					sideOffset={0}
					className="w-80 p-0 text-xs"
				>
					<Command shouldFilter={false}>
						<CommandInput
							placeholder="Search files..."
							value={searchQuery}
							onValueChange={setSearchQuery}
						/>
						<CommandList className="max-h-[280px] [&::-webkit-scrollbar]:hidden">
							{!isSearching && browsingPath && (
								<CommandGroup>
									<CommandItem onSelect={handleGoUp}>
										<span className="text-muted-foreground">←</span>
										<span className="truncate text-xs text-muted-foreground">
											..
										</span>
									</CommandItem>
								</CommandGroup>
							)}
							{files.length === 0 && (
								<CommandEmpty className="px-2 py-3 text-left text-xs text-muted-foreground">
									{isSearchPending
										? "Searching..."
										: isSearching
											? "No results found."
											: "Empty directory"}
								</CommandEmpty>
							)}
							{files.length > 0 && (
								<CommandGroup
									heading={isSearching ? "Search results" : browsingPath || "/"}
								>
									{files.map((file) => {
										const dirPath = isSearching
											? getDirectoryPath(file.relativePath)
											: "";
										return (
											<CommandItem
												key={file.id}
												value={file.relativePath}
												onSelect={() =>
													handleSelectEntry(file.relativePath, file.isDirectory)
												}
											>
												{file.isDirectory ? (
													<span className="size-3.5 shrink-0 text-center text-muted-foreground">
														📁
													</span>
												) : (
													<FileIcon
														fileName={file.name}
														className="size-3.5 shrink-0"
													/>
												)}
												<span className="truncate text-xs">
													{file.name}
													{file.isDirectory ? "/" : ""}
												</span>
												{dirPath && (
													<span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
														{dirPath}
													</span>
												)}
											</CommandItem>
										);
									})}
								</CommandGroup>
							)}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</MentionContext.Provider>
	);
}

export function MentionAnchor({ children }: { children: ReactNode }) {
	return <PopoverAnchor asChild>{children}</PopoverAnchor>;
}

export function MentionTrigger() {
	const ctx = useContext(MentionContext);
	return (
		<PopoverTrigger asChild>
			<PromptInputButton onClick={() => ctx?.setOpen(!ctx.open)}>
				<HiMiniAtSymbol className="size-4" />
			</PromptInputButton>
		</PopoverTrigger>
	);
}
