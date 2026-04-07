import { useQuery } from "@tanstack/react-query";
import {
	getHostServiceClientByUrl,
	type HostServiceClient,
} from "renderer/lib/host-service-client";
import {
	resolveCreateWorkspaceHostUrl,
	type WorkspaceHostTarget,
} from "renderer/lib/v2-workspace-host";
import { useWorkspaceHostOptions } from "../../components/DevicePicker/hooks/useWorkspaceHostOptions";

/**
 * Fetches branch data for the create-workspace composer from the host-service.
 * Accepts a V2 project ID + host target directly — no local-project resolution needed.
 */
export function useBranchContext(
	projectId: string | null,
	hostTarget: WorkspaceHostTarget,
) {
	const { localHostService } = useWorkspaceHostOptions();
	const hostUrl = resolveCreateWorkspaceHostUrl(
		hostTarget,
		localHostService?.url ?? null,
	);

	return useQuery({
		queryKey: ["workspaceCreation", "searchBranches", projectId, hostUrl],
		queryFn: async () => {
			if (!hostUrl || !projectId) {
				return { defaultBranch: null, branches: [] };
			}

			const client: HostServiceClient =
				hostTarget.kind === "local" && localHostService
					? localHostService.client
					: getHostServiceClientByUrl(hostUrl);

			return client.workspaceCreation.searchBranches.query({
				projectId,
			});
		},
		enabled: !!projectId && !!hostUrl,
	});
}
