import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { env } from "renderer/env.renderer";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import type { WorkspaceHostTarget } from "../../components/DevicePicker";

export type BranchRow = {
	name: string;
	lastCommitDate: number;
	isLocal: boolean;
	isRemote: boolean;
	recency: number | null;
	worktreePath: string | null;
};

const PAGE_SIZE = 50;

type BranchPage = {
	defaultBranch: string | null;
	items: BranchRow[];
	nextCursor: string | null;
};

/**
 * Paginated branch search via host-service. First page of a (projectId, host,
 * query) tuple asks to refresh remote refs; the host-service enforces a TTL so
 * rapid typing doesn't thrash `git fetch`.
 */
export function useBranchContext(
	projectId: string | null,
	hostTarget: WorkspaceHostTarget,
	query: string,
) {
	const { activeHostUrl } = useLocalHostService();
	const hostUrl =
		hostTarget.kind === "local"
			? activeHostUrl
			: `${env.RELAY_URL}/hosts/${hostTarget.hostId}`;

	const q = useInfiniteQuery({
		queryKey: [
			"workspaceCreation",
			"searchBranches",
			projectId,
			hostUrl,
			query,
		],
		enabled: !!projectId && !!hostUrl,
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (last: BranchPage) => last.nextCursor ?? undefined,
		queryFn: async ({ pageParam }): Promise<BranchPage> => {
			if (!hostUrl || !projectId) {
				return { defaultBranch: null, items: [], nextCursor: null };
			}
			const client = getHostServiceClientByUrl(hostUrl);
			return client.workspaceCreation.searchBranches.query({
				projectId,
				query: query || undefined,
				cursor: pageParam,
				limit: PAGE_SIZE,
				refresh: pageParam === undefined,
			});
		},
	});

	const pages = q.data?.pages as BranchPage[] | undefined;
	const branches = useMemo<BranchRow[]>(
		() => pages?.flatMap((p) => p.items) ?? [],
		[pages],
	);

	const defaultBranch = pages?.[0]?.defaultBranch ?? null;

	return {
		branches,
		defaultBranch,
		isLoading: q.isLoading,
		isError: q.isError,
		isFetchingNextPage: q.isFetchingNextPage,
		hasNextPage: q.hasNextPage,
		fetchNextPage: q.fetchNextPage,
	};
}
