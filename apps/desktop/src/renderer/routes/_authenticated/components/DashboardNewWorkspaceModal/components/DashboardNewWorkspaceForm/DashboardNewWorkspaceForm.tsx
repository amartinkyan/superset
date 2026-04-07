import {
	PromptInput,
	PromptInputAttachment,
	PromptInputAttachments,
	PromptInputButton,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputAttachments,
	useProviderAttachments,
} from "@superset/ui/ai-elements/prompt-input";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@superset/ui/command";
import { Input } from "@superset/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpIcon, PaperclipIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoGitBranch, GoIssueOpened } from "react-icons/go";
import { HiCheck, HiChevronUpDown } from "react-icons/hi2";
import { LuGitPullRequest } from "react-icons/lu";
import { SiLinear } from "react-icons/si";
import { AgentSelect } from "renderer/components/AgentSelect";
import { LinkedIssuePill } from "renderer/components/Chat/ChatInterface/components/ChatInputFooter/components/LinkedIssuePill";
import { IssueLinkCommand } from "renderer/components/Chat/ChatInterface/components/IssueLinkCommand";
import { useAgentLaunchPreferences } from "renderer/hooks/useAgentLaunchPreferences";
import { PLATFORM } from "renderer/hotkeys";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { navigateToV2Workspace } from "renderer/routes/_authenticated/_dashboard/utils/workspace-navigation";
import {
	useClearPendingWorkspace,
	useNewWorkspaceModalOpen,
	useSetPendingWorkspace,
	useSetPendingWorkspaceStatus,
} from "renderer/stores/new-workspace-modal";
import {
	type AgentDefinitionId,
	getEnabledAgentConfigs,
} from "shared/utils/agent-settings";
import { sanitizeBranchNameWithMaxLength } from "shared/utils/branch";
import {
	type LinkedPR,
	useDashboardNewWorkspaceDraft,
} from "../../DashboardNewWorkspaceDraftContext";
import { useCreateDashboardWorkspace } from "../../hooks/useCreateDashboardWorkspace";
import { DevicePicker } from "./components/DevicePicker";
import { GitHubIssueLinkCommand } from "./components/GitHubIssueLinkCommand";
import { LinkedGitHubIssuePill } from "./components/LinkedGitHubIssuePill";
import { LinkedPRPill } from "./components/LinkedPRPill";
import { PRLinkCommand } from "./components/PRLinkCommand";
import { ProjectSelector } from "./components/ProjectSelector";
import { useDashboardNewWorkspaceProjectSelection } from "./hooks/useDashboardNewWorkspaceProjectSelection";
import { useResolvedLocalProject } from "./hooks/useResolvedLocalProject";

type WorkspaceCreateAgent = AgentDefinitionId | "none";

const AGENT_STORAGE_KEY = "lastSelectedWorkspaceCreateAgent";

const PILL_BUTTON_CLASS =
	"!h-[22px] min-h-0 rounded-md border-[0.5px] border-border bg-foreground/[0.04] shadow-none text-[11px]";

type ConvertedFile = {
	data: string;
	mediaType: string;
	filename?: string;
};

// ── Attachment Buttons ────────────────────────────────────────────────

function AttachmentButtons({
	anchorRef,
	onOpenIssueLink,
	onOpenGitHubIssue,
	onOpenPRLink,
}: {
	anchorRef: React.RefObject<HTMLDivElement | null>;
	onOpenIssueLink: () => void;
	onOpenGitHubIssue: () => void;
	onOpenPRLink: () => void;
}) {
	const attachments = usePromptInputAttachments();

	return (
		<div ref={anchorRef} className="flex items-center gap-1">
			<Tooltip>
				<TooltipTrigger asChild>
					<PromptInputButton
						className={`${PILL_BUTTON_CLASS} w-[22px]`}
						onClick={() => attachments.openFileDialog()}
					>
						<PaperclipIcon className="size-3.5" />
					</PromptInputButton>
				</TooltipTrigger>
				<TooltipContent side="bottom">Add attachment</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<PromptInputButton
						className={`${PILL_BUTTON_CLASS} w-[22px]`}
						onClick={onOpenIssueLink}
					>
						<SiLinear className="size-3.5" />
					</PromptInputButton>
				</TooltipTrigger>
				<TooltipContent side="bottom">Link issue</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<PromptInputButton
						className={`${PILL_BUTTON_CLASS} w-[22px]`}
						onClick={onOpenGitHubIssue}
					>
						<GoIssueOpened className="size-3.5" />
					</PromptInputButton>
				</TooltipTrigger>
				<TooltipContent side="bottom">Link GitHub issue</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<PromptInputButton
						className={`${PILL_BUTTON_CLASS} w-[22px]`}
						onClick={onOpenPRLink}
					>
						<LuGitPullRequest className="size-3.5" />
					</PromptInputButton>
				</TooltipTrigger>
				<TooltipContent side="bottom">Link pull request</TooltipContent>
			</Tooltip>
		</div>
	);
}

// ── Compare Base Branch Picker ────────────────────────────────────────

function CompareBaseBranchPicker({
	effectiveCompareBaseBranch,
	defaultBranch,
	isBranchesLoading,
	isBranchesError,
	branches,
	onSelectCompareBaseBranch,
}: {
	effectiveCompareBaseBranch: string | null;
	defaultBranch?: string;
	isBranchesLoading: boolean;
	isBranchesError: boolean;
	branches: Array<{ name: string; lastCommitDate: number; isLocal: boolean }>;
	onSelectCompareBaseBranch: (branchName: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [branchSearch, setBranchSearch] = useState("");

	const filteredBranches = useMemo(() => {
		if (!branches.length) return [];
		if (!branchSearch) return branches;
		const searchLower = branchSearch.toLowerCase();
		return branches.filter((branch) =>
			branch.name.toLowerCase().includes(searchLower),
		);
	}, [branches, branchSearch]);

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
				if (!v) setBranchSearch("");
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={isBranchesLoading}
					className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 min-w-0 max-w-full"
				>
					<GoGitBranch className="size-3 shrink-0" />
					{isBranchesLoading ? (
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
				className="w-80 p-0"
				align="start"
				onWheel={(event) => event.stopPropagation()}
			>
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search branches..."
						value={branchSearch}
						onValueChange={setBranchSearch}
					/>
					<CommandList className="max-h-[300px]">
						<CommandEmpty>No branches found</CommandEmpty>
						{filteredBranches.map((branch) => (
							<CommandItem
								key={branch.name}
								value={branch.name}
								onSelect={() => {
									onSelectCompareBaseBranch(branch.name);
									setOpen(false);
								}}
								className="flex items-center justify-between"
							>
								<span className="flex items-center gap-2 truncate">
									<GoGitBranch className="size-3.5 shrink-0 text-muted-foreground" />
									<span className="truncate font-mono text-xs">
										{branch.name}
									</span>
									{branch.name === defaultBranch && (
										<span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
											default
										</span>
									)}
								</span>
								{effectiveCompareBaseBranch === branch.name && (
									<HiCheck className="size-4 text-primary" />
								)}
							</CommandItem>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

// ── Main Form ─────────────────────────────────────────────────────────

interface DashboardNewWorkspaceFormProps {
	isOpen: boolean;
	preSelectedProjectId: string | null;
}

export function DashboardNewWorkspaceForm({
	isOpen,
	preSelectedProjectId,
}: DashboardNewWorkspaceFormProps) {
	const navigate = useNavigate();
	const modKey = PLATFORM === "mac" ? "⌘" : "Ctrl";
	const isNewWorkspaceModalOpen = useNewWorkspaceModalOpen();
	const { closeAndResetDraft, closeModal, draft, runAsyncAction, updateDraft } =
		useDashboardNewWorkspaceDraft();
	const attachments = useProviderAttachments();
	const clearPendingWorkspace = useClearPendingWorkspace();
	const setPendingWorkspace = useSetPendingWorkspace();
	const setPendingWorkspaceStatus = useSetPendingWorkspaceStatus();

	const {
		compareBaseBranch,
		prompt,
		runSetupScript,
		workspaceName,
		workspaceNameEdited,
		branchName,
		branchNameEdited,
		linkedIssues,
		linkedPR,
		hostTarget,
	} = draft;

	// ── Project selection ────────────────────────────────────────────
	const handleSelectProject = useCallback(
		(selectedProjectId: string | null) => {
			updateDraft({ selectedProjectId });
		},
		[updateDraft],
	);
	const { githubRepository } = useDashboardNewWorkspaceProjectSelection({
		isOpen,
		preSelectedProjectId,
		selectedProjectId: draft.selectedProjectId,
		onSelectProject: handleSelectProject,
	});
	const resolvedLocalProjectId = useResolvedLocalProject(githubRepository);

	// ── Agent presets ────────────────────────────────────────────────
	const agentPresetsQuery = electronTrpc.settings.getAgentPresets.useQuery();
	const agentPresets = agentPresetsQuery.data ?? [];
	const enabledAgentPresets = useMemo(
		() => getEnabledAgentConfigs(agentPresets),
		[agentPresets],
	);
	const selectableAgentIds = useMemo(
		() => enabledAgentPresets.map((preset) => preset.id),
		[enabledAgentPresets],
	);
	const { selectedAgent, setSelectedAgent } =
		useAgentLaunchPreferences<WorkspaceCreateAgent>({
			agentStorageKey: AGENT_STORAGE_KEY,
			defaultAgent: "claude",
			fallbackAgent: "none",
			validAgents: ["none", ...selectableAgentIds],
			agentsReady: agentPresetsQuery.isFetched,
		});

	// ── Branch data (via local project electronTrpc for now) ─────────
	const hasLocalProject = !!resolvedLocalProjectId;

	const { data: project } = electronTrpc.projects.get.useQuery(
		{ id: resolvedLocalProjectId ?? "" },
		{ enabled: hasLocalProject },
	);

	const {
		data: localBranchData,
		isLoading: isLocalBranchesLoading,
		isError: isBranchesError,
	} = electronTrpc.projects.getBranchesLocal.useQuery(
		{ projectId: resolvedLocalProjectId ?? "" },
		{ enabled: hasLocalProject },
	);
	const { data: remoteBranchData } = electronTrpc.projects.getBranches.useQuery(
		{ projectId: resolvedLocalProjectId ?? "" },
		{ enabled: hasLocalProject },
	);
	const branchData = remoteBranchData ?? localBranchData;
	const isBranchesLoading = isLocalBranchesLoading && !branchData;

	const effectiveCompareBaseBranch = useMemo(() => {
		if (compareBaseBranch) return compareBaseBranch;
		if (project?.workspaceBaseBranch) return project.workspaceBaseBranch;
		return branchData?.defaultBranch ?? null;
	}, [
		compareBaseBranch,
		project?.workspaceBaseBranch,
		branchData?.defaultBranch,
	]);

	// ── Link state ───────────────────────────────────────────────────
	const [issueLinkOpen, setIssueLinkOpen] = useState(false);
	const [gitHubIssueLinkOpen, setGitHubIssueLinkOpen] = useState(false);
	const [prLinkOpen, setPRLinkOpen] = useState(false);
	const plusMenuRef = useRef<HTMLDivElement>(null);
	const submitStartedRef = useRef(false);
	const trimmedPrompt = prompt.trim();

	// ── AI branch name ───────────────────────────────────────────────
	const generateBranchNameMutation =
		electronTrpc.workspaces.generateBranchName.useMutation();

	useEffect(() => {
		if (isNewWorkspaceModalOpen) {
			submitStartedRef.current = false;
		}
	}, [isNewWorkspaceModalOpen]);

	const previousProjectIdRef = useRef(draft.selectedProjectId);
	useEffect(() => {
		if (previousProjectIdRef.current === draft.selectedProjectId) return;
		previousProjectIdRef.current = draft.selectedProjectId;
		updateDraft({ compareBaseBranch: null });
	}, [draft.selectedProjectId, updateDraft]);

	// ── Create workspace ─────────────────────────────────────────────
	const { createWorkspace } = useCreateDashboardWorkspace();

	const convertBlobUrlToDataUrl = useCallback(
		async (url: string): Promise<string> => {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`Failed to fetch attachment: ${response.statusText}`);
			}
			const blob = await response.blob();
			return new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve(reader.result as string);
				reader.onerror = () =>
					reject(new Error("Failed to read attachment data"));
				reader.onabort = () => reject(new Error("Attachment read was aborted"));
				reader.readAsDataURL(blob);
			});
		},
		[],
	);

	const handleCreate = useCallback(async () => {
		if (!draft.selectedProjectId) {
			toast.error("Select a project first");
			return;
		}

		if (submitStartedRef.current) return;
		submitStartedRef.current = true;

		const displayName =
			workspaceNameEdited && workspaceName.trim()
				? workspaceName.trim()
				: trimmedPrompt || "New workspace";
		const willGenerateAIName =
			!branchNameEdited && !!trimmedPrompt && !linkedPR;
		const pendingWorkspaceId = crypto.randomUUID();
		const detachedFiles = attachments.takeFiles();

		setPendingWorkspace({
			id: pendingWorkspaceId,
			projectId: draft.selectedProjectId,
			name: displayName,
			status: willGenerateAIName ? "generating-branch" : "preparing",
		});
		closeAndResetDraft();

		try {
			// AI branch name generation
			let aiBranchName: string | null = null;
			if (willGenerateAIName) {
				try {
					const result = await Promise.race([
						generateBranchNameMutation.mutateAsync({
							prompt: trimmedPrompt,
							projectId: draft.selectedProjectId,
						}),
						new Promise<never>((_, reject) =>
							setTimeout(() => reject(new Error("timeout")), 30000),
						),
					]);
					aiBranchName = result.branchName;
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					if (
						msg.includes("auth") ||
						msg.includes("401") ||
						msg.includes("403")
					) {
						clearPendingWorkspace(pendingWorkspaceId);
						toast.error("AI authentication failed.");
						return;
					}
					toast.info("Using random branch name");
				} finally {
					setPendingWorkspaceStatus(pendingWorkspaceId, "preparing");
				}
			}

			// Convert attachments
			let convertedFiles: ConvertedFile[] = [];
			if (detachedFiles.length > 0) {
				try {
					convertedFiles = await Promise.all(
						detachedFiles.map(async (file) => ({
							data: await convertBlobUrlToDataUrl(file.url),
							mediaType: file.mediaType,
							filename: file.filename,
						})),
					);
				} catch (err) {
					clearPendingWorkspace(pendingWorkspaceId);
					toast.error(
						err instanceof Error
							? err.message
							: "Failed to process attachments",
					);
					return;
				}
			}

			setPendingWorkspaceStatus(pendingWorkspaceId, "creating");

			const resolvedBranchName =
				(branchNameEdited && branchName.trim()
					? sanitizeBranchNameWithMaxLength(branchName.trim(), undefined, {
							preserveCase: true,
						})
					: aiBranchName) || undefined;

			const source = linkedPR ? ("pull-request" as const) : ("prompt" as const);

			void runAsyncAction(
				createWorkspace({
					projectId: draft.selectedProjectId,
					hostTarget,
					source,
					names: {
						workspaceName:
							workspaceNameEdited && workspaceName.trim()
								? workspaceName.trim()
								: undefined,
						branchName: resolvedBranchName,
					},
					composer: {
						prompt: trimmedPrompt || undefined,
						compareBaseBranch: compareBaseBranch || undefined,
						runSetupScript,
					},
					linkedContext: {
						linkedPrUrl: linkedPR?.url,
						attachments: convertedFiles.length > 0 ? convertedFiles : undefined,
					},
				}).then((result) => {
					if (result.workspace) {
						navigateToV2Workspace(result.workspace.id, navigate);
					}
					return result;
				}),
				{
					loading: "Creating workspace...",
					success: "Workspace created",
					error: (err) =>
						err instanceof Error ? err.message : "Failed to create workspace",
				},
				{ closeAndReset: false },
			).finally(() => {
				clearPendingWorkspace(pendingWorkspaceId);
			});
		} finally {
			for (const file of detachedFiles) {
				if (file.url?.startsWith("blob:")) {
					URL.revokeObjectURL(file.url);
				}
			}
		}
	}, [
		attachments,
		branchName,
		branchNameEdited,
		clearPendingWorkspace,
		closeAndResetDraft,
		compareBaseBranch,
		convertBlobUrlToDataUrl,
		createWorkspace,
		draft.selectedProjectId,
		generateBranchNameMutation,
		hostTarget,
		linkedPR,
		navigate,
		runAsyncAction,
		runSetupScript,
		setPendingWorkspace,
		setPendingWorkspaceStatus,
		trimmedPrompt,
		workspaceName,
		workspaceNameEdited,
	]);

	const handlePromptSubmit = useCallback(() => {
		void handleCreate();
	}, [handleCreate]);

	useEffect(() => {
		if (!isNewWorkspaceModalOpen) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				void handleCreate();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [isNewWorkspaceModalOpen, handleCreate]);

	// ── Issue / PR linking helpers ───────────────────────────────────

	const addLinkedIssue = (
		slug: string,
		title: string,
		taskId: string | undefined,
		url?: string,
	) => {
		if (linkedIssues.some((issue) => issue.slug === slug)) return;
		updateDraft({
			linkedIssues: [
				...linkedIssues,
				{ slug, title, source: "internal", taskId, url },
			],
		});
	};

	const addLinkedGitHubIssue = (
		issueNumber: number,
		title: string,
		url: string,
		state: string,
	) => {
		const normalizedState: "open" | "closed" =
			state.toLowerCase() === "closed" ? "closed" : "open";
		const issue = {
			slug: `#${issueNumber}`,
			title,
			source: "github" as const,
			url,
			number: issueNumber,
			state: normalizedState,
		};
		if (linkedIssues.some((i) => i.url === url)) return;
		updateDraft({ linkedIssues: [...linkedIssues, issue] });
	};

	const removeLinkedIssue = (slug: string) => {
		updateDraft({
			linkedIssues: linkedIssues.filter((issue) => issue.slug !== slug),
		});
	};

	const setLinkedPR = (pr: LinkedPR) => {
		updateDraft({ linkedPR: pr });
	};

	const removeLinkedPR = () => {
		updateDraft({ linkedPR: null });
	};

	// ── Render ────────────────────────────────────────────────────────

	return (
		<div className="p-3 space-y-2">
			{/* Workspace name + branch name header */}
			<div className="flex items-center">
				<Input
					className="border-none bg-transparent dark:bg-transparent shadow-none text-base font-medium px-0 h-auto focus-visible:ring-0 placeholder:text-muted-foreground/40 min-w-0 flex-1"
					placeholder="Workspace name (optional)"
					value={workspaceName}
					onChange={(e) =>
						updateDraft({
							workspaceName: e.target.value,
							workspaceNameEdited: true,
						})
					}
					onBlur={() => {
						if (!workspaceName.trim()) {
							updateDraft({ workspaceName: "", workspaceNameEdited: false });
						}
					}}
				/>
				<div className="shrink min-w-0 ml-auto max-w-[50%]">
					<Input
						className={cn(
							"border-none bg-transparent dark:bg-transparent shadow-none text-xs font-mono text-muted-foreground/60 px-0 h-auto focus-visible:ring-0 placeholder:text-muted-foreground/30 focus:text-muted-foreground text-right placeholder:text-right overflow-hidden text-ellipsis",
						)}
						placeholder="branch name"
						value={branchName}
						onChange={(e) =>
							updateDraft({
								branchName: e.target.value.replace(/\s+/g, "-"),
								branchNameEdited: true,
							})
						}
						onBlur={() => {
							const sanitized = sanitizeBranchNameWithMaxLength(
								branchName.trim(),
								undefined,
								{ preserveCase: true },
							);
							if (!sanitized) {
								updateDraft({ branchName: "", branchNameEdited: false });
							} else {
								updateDraft({ branchName: sanitized });
							}
						}}
					/>
				</div>
			</div>

			{/* Rich prompt input */}
			<PromptInput
				onSubmit={handlePromptSubmit}
				multiple
				maxFiles={5}
				maxFileSize={10 * 1024 * 1024}
				className="[&>[data-slot=input-group]]:rounded-[13px] [&>[data-slot=input-group]]:border-[0.5px] [&>[data-slot=input-group]]:shadow-none [&>[data-slot=input-group]]:bg-foreground/[0.02]"
			>
				{(linkedPR ||
					linkedIssues.length > 0 ||
					attachments.files.length > 0) && (
					<div className="flex flex-wrap items-start gap-2 px-3 pt-3 self-stretch">
						<AnimatePresence initial={false}>
							{linkedPR && (
								<motion.div
									key="linked-pr"
									initial={{ opacity: 0, scale: 0.8 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.8 }}
									transition={{ duration: 0.15 }}
								>
									<LinkedPRPill
										prNumber={linkedPR.prNumber}
										title={linkedPR.title}
										state={linkedPR.state}
										onRemove={removeLinkedPR}
									/>
								</motion.div>
							)}
							{linkedIssues.map((issue) => (
								<motion.div
									key={issue.slug}
									initial={{ opacity: 0, scale: 0.8 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.8 }}
									transition={{ duration: 0.15 }}
								>
									{issue.source === "github" ? (
										<LinkedGitHubIssuePill
											issueNumber={issue.number ?? 0}
											title={issue.title}
											state={issue.state ?? "open"}
											onRemove={() => removeLinkedIssue(issue.slug)}
										/>
									) : (
										<LinkedIssuePill
											slug={issue.slug}
											title={issue.title}
											url={issue.url}
											taskId={issue.taskId}
											onRemove={() => removeLinkedIssue(issue.slug)}
										/>
									)}
								</motion.div>
							))}
						</AnimatePresence>
						<PromptInputAttachments>
							{(file) => <PromptInputAttachment data={file} />}
						</PromptInputAttachments>
					</div>
				)}
				<PromptInputTextarea
					autoFocus
					placeholder="What do you want to do?"
					className="min-h-10"
					value={prompt}
					onChange={(e) => updateDraft({ prompt: e.target.value })}
				/>
				<PromptInputFooter>
					<PromptInputTools className="gap-1.5">
						<AgentSelect<WorkspaceCreateAgent>
							agents={enabledAgentPresets}
							value={selectedAgent}
							placeholder="No agent"
							onValueChange={setSelectedAgent}
							onBeforeConfigureAgents={closeModal}
							triggerClassName={`${PILL_BUTTON_CLASS} px-1.5 gap-1 text-foreground w-auto max-w-[160px]`}
							iconClassName="size-3 object-contain"
							allowNone
							noneLabel="No agent"
							noneValue="none"
						/>
					</PromptInputTools>
					<div className="flex items-center gap-2">
						<AttachmentButtons
							anchorRef={plusMenuRef}
							onOpenIssueLink={() =>
								requestAnimationFrame(() => setIssueLinkOpen(true))
							}
							onOpenGitHubIssue={() =>
								requestAnimationFrame(() => setGitHubIssueLinkOpen(true))
							}
							onOpenPRLink={() =>
								requestAnimationFrame(() => setPRLinkOpen(true))
							}
						/>
						<IssueLinkCommand
							variant="popover"
							anchorRef={plusMenuRef}
							open={issueLinkOpen}
							onOpenChange={setIssueLinkOpen}
							onSelect={addLinkedIssue}
						/>
						<GitHubIssueLinkCommand
							open={gitHubIssueLinkOpen}
							onOpenChange={setGitHubIssueLinkOpen}
							onSelect={(issue) =>
								addLinkedGitHubIssue(
									issue.issueNumber,
									issue.title,
									issue.url,
									issue.state,
								)
							}
							projectId={resolvedLocalProjectId}
							anchorRef={plusMenuRef}
						/>
						<PRLinkCommand
							open={prLinkOpen}
							onOpenChange={setPRLinkOpen}
							onSelect={setLinkedPR}
							projectId={resolvedLocalProjectId}
							githubOwner={project?.githubOwner ?? null}
							repoName={project?.mainRepoPath.split("/").pop() ?? null}
							anchorRef={plusMenuRef}
						/>
						<PromptInputSubmit
							className="size-[22px] rounded-full border border-transparent bg-foreground/10 shadow-none p-[5px] hover:bg-foreground/20"
							onClick={(e) => {
								e.preventDefault();
								void handleCreate();
							}}
						>
							<ArrowUpIcon className="size-3.5 text-muted-foreground" />
						</PromptInputSubmit>
					</div>
				</PromptInputFooter>
			</PromptInput>

			{/* Bottom bar: project, branch, host target, shortcut hint */}
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2 min-w-0 flex-1">
					<ProjectSelector
						selectedProjectId={draft.selectedProjectId}
						onSelectProject={(id) => updateDraft({ selectedProjectId: id })}
					/>
					<AnimatePresence mode="wait" initial={false}>
						{linkedPR ? (
							<motion.span
								key="linked-pr-label"
								initial={{ opacity: 0, x: -8, filter: "blur(4px)" }}
								animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
								exit={{ opacity: 0, x: 8, filter: "blur(4px)" }}
								transition={{ duration: 0.2, ease: "easeOut" }}
								className="flex items-center gap-1 text-xs text-muted-foreground"
							>
								<LuGitPullRequest className="size-3 shrink-0" />
								based off PR #{linkedPR.prNumber}
							</motion.span>
						) : hasLocalProject ? (
							<motion.div
								key="branch-picker"
								className="min-w-0"
								initial={{ opacity: 0, x: -8, filter: "blur(4px)" }}
								animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
								exit={{ opacity: 0, x: 8, filter: "blur(4px)" }}
								transition={{ duration: 0.2, ease: "easeOut" }}
							>
								<CompareBaseBranchPicker
									effectiveCompareBaseBranch={effectiveCompareBaseBranch}
									defaultBranch={branchData?.defaultBranch}
									isBranchesLoading={isBranchesLoading}
									isBranchesError={isBranchesError}
									branches={branchData?.branches ?? []}
									onSelectCompareBaseBranch={(branch) =>
										updateDraft({ compareBaseBranch: branch })
									}
								/>
							</motion.div>
						) : null}
					</AnimatePresence>
				</div>
				<div className="flex items-center gap-1.5">
					<DevicePicker
						hostTarget={hostTarget}
						onSelectHostTarget={(hostTarget) => updateDraft({ hostTarget })}
					/>
					<span className="text-[11px] text-muted-foreground/50">
						{modKey}↵
					</span>
				</div>
			</div>
		</div>
	);
}
