import type { AppRouter } from "@superset/host-service";
import { workspaceTrpc } from "@superset/workspace-client";
import type { inferRouterOutputs } from "@trpc/server";
import { useMemo } from "react";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";

type ChangedFile =
	inferRouterOutputs<AppRouter>["git"]["getStatus"]["againstBase"][number];
export type FileStatus = ChangedFile["status"];

export interface UseGitStatusMapParams {
	workspaceId: string;
}

export interface UseGitStatusMapResult {
	statusByPath: Map<string, FileStatus>;
	changedAncestors: Set<string>;
	worstStatusByFolder: Map<string, FileStatus>;
	ignoredPaths: Set<string>;
}

/**
 * Precedence used when a folder has descendants with multiple statuses — the
 * folder takes the "worst" (most severe) status for its dot color.
 */
const STATUS_SEVERITY: Record<FileStatus, number> = {
	deleted: 5,
	modified: 4,
	changed: 4,
	added: 3,
	untracked: 2,
	renamed: 1,
	copied: 0,
};

const EMPTY_RESULT: UseGitStatusMapResult = {
	statusByPath: new Map(),
	changedAncestors: new Set(),
	worstStatusByFolder: new Map(),
	ignoredPaths: new Set(),
};

/**
 * Pure derivation hook over the existing `git.getStatus` query cache. Returns
 * lookup maps for decorating the file tree with git status + gitignored
 * muting.
 *
 * Deliberately does NOT subscribe to `git:changed` or `fs:events`:
 * `useChangesTab` is mounted unconditionally in `WorkspaceSidebar` and already
 * owns the debounced invalidate. Because this hook calls the query with the
 * same key, React Query shares one cache entry — when `useChangesTab`
 * invalidates, our `useMemo` re-derives automatically. Adding another
 * subscription here would cause duplicate event handlers and duplicate
 * refetches.
 */
export function useGitStatusMap({
	workspaceId,
}: UseGitStatusMapParams): UseGitStatusMapResult {
	const collections = useCollections();
	const localState = collections.v2WorkspaceLocalState.get(workspaceId);
	const baseBranch: string | null =
		localState?.sidebarState?.baseBranch ?? null;

	const status = workspaceTrpc.git.getStatus.useQuery(
		{ workspaceId, baseBranch: baseBranch ?? undefined },
		{ refetchOnWindowFocus: true, enabled: Boolean(workspaceId) },
	);

	return useMemo(() => {
		if (!status.data) return EMPTY_RESULT;

		// Union of all changes — later writes win so uncommitted state
		// overrides committed state. Same pattern as useChangesTab's "all" filter.
		const merged = new Map<string, FileStatus>();
		for (const file of status.data.againstBase) {
			merged.set(normalizePath(file.path), file.status);
		}
		for (const file of status.data.staged) {
			merged.set(normalizePath(file.path), file.status);
		}
		for (const file of status.data.unstaged) {
			merged.set(normalizePath(file.path), file.status);
		}

		const changedAncestors = new Set<string>();
		const worstStatusByFolder = new Map<string, FileStatus>();
		for (const [path, fileStatus] of merged) {
			const segments = path.split("/");
			for (let i = 1; i < segments.length; i++) {
				const ancestor = segments.slice(0, i).join("/");
				changedAncestors.add(ancestor);
				const existing = worstStatusByFolder.get(ancestor);
				if (
					!existing ||
					STATUS_SEVERITY[fileStatus] > STATUS_SEVERITY[existing]
				) {
					worstStatusByFolder.set(ancestor, fileStatus);
				}
			}
		}

		const ignoredPaths = new Set<string>();
		for (const entry of status.data.ignoredPaths) {
			ignoredPaths.add(normalizePath(entry).replace(/\/$/, ""));
		}

		return {
			statusByPath: merged,
			changedAncestors,
			worstStatusByFolder,
			ignoredPaths,
		};
	}, [status.data]);
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/");
}
