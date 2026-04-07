import { useCallback, useState } from "react";
import {
	getHostServiceClientByUrl,
	type HostServiceClient,
} from "renderer/lib/host-service-client";
import {
	resolveCreateWorkspaceHostUrl,
	type WorkspaceHostTarget,
} from "renderer/lib/v2-workspace-host";
import { useDashboardSidebarState } from "renderer/routes/_authenticated/hooks/useDashboardSidebarState";
import { useWorkspaceHostOptions } from "../../components/DashboardNewWorkspaceForm/components/DevicePicker/hooks/useWorkspaceHostOptions";

interface CreateDashboardWorkspaceInput {
	projectId: string;
	hostTarget: WorkspaceHostTarget;
	source: "prompt" | "pull-request" | "branch" | "issue";
	names: {
		workspaceName?: string;
		branchName?: string;
	};
	composer: {
		prompt?: string;
		compareBaseBranch?: string;
		runSetupScript?: boolean;
	};
	linkedContext?: {
		internalIssueIds?: string[];
		githubIssueUrls?: string[];
		linkedPrUrl?: string;
		attachments?: Array<{
			data: string;
			mediaType: string;
			filename?: string;
		}>;
	};
	launch?: {
		agentId?: string;
		autoRun?: boolean;
	};
	behavior?: {
		onExistingWorkspace?: "open" | "error";
		onExistingWorktree?: "adopt" | "error";
	};
}

export type CreateWorkspaceOutcome =
	| "created_workspace"
	| "opened_existing_workspace"
	| "opened_worktree"
	| "adopted_external_worktree";

interface CreateWorkspaceResult {
	outcome: CreateWorkspaceOutcome;
	workspace: { id: string };
	init: { phase: string; progress: number | null };
	warnings: string[];
}

export function useCreateDashboardWorkspace() {
	const [isPending, setIsPending] = useState(false);
	const { localHostService } = useWorkspaceHostOptions();
	const { ensureWorkspaceInSidebar } = useDashboardSidebarState();

	const createWorkspace = useCallback(
		async (
			input: CreateDashboardWorkspaceInput,
		): Promise<CreateWorkspaceResult> => {
			setIsPending(true);
			try {
				const hostUrl = resolveCreateWorkspaceHostUrl(
					input.hostTarget,
					localHostService?.url ?? null,
				);
				if (!hostUrl) {
					throw new Error("Host service not available");
				}

				const client: HostServiceClient =
					input.hostTarget.kind === "local" && localHostService
						? localHostService.client
						: getHostServiceClientByUrl(hostUrl);

				const result = await client.workspaceCreation.create.mutate({
					projectId: input.projectId,
					source: input.source,
					names: input.names,
					composer: input.composer,
					linkedContext: input.linkedContext,
					launch: input.launch,
					behavior: input.behavior,
				});

				if (result.workspace) {
					ensureWorkspaceInSidebar(result.workspace.id, input.projectId);
				}

				return result as CreateWorkspaceResult;
			} finally {
				setIsPending(false);
			}
		},
		[ensureWorkspaceInSidebar, localHostService],
	);

	return { createWorkspace, isPending };
}
