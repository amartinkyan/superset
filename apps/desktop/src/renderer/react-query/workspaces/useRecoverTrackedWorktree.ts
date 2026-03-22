import { toast } from "@superset/ui/sonner";
import { electronTrpc } from "renderer/lib/electron-trpc";

interface UseRecoverTrackedWorktreeOptions {
	workspaceId: string;
	defaultPath?: string | null;
}

export function useRecoverTrackedWorktree({
	workspaceId,
	defaultPath,
}: UseRecoverTrackedWorktreeOptions) {
	const utils = electronTrpc.useUtils();
	const selectDirectory = electronTrpc.window.selectDirectory.useMutation();
	const repairTrackedWorktree =
		electronTrpc.workspaces.repairTrackedWorktreePath.useMutation({
			onSuccess: async () => {
				await Promise.all([
					utils.workspaces.invalidate(),
					utils.terminal.invalidate(),
				]);
				toast.success("Worktree recovered");
			},
			onError: (error) => {
				toast.error(`Failed to recover worktree: ${error.message}`);
			},
		});

	const recoverTrackedWorktree = async () => {
		const result = await selectDirectory.mutateAsync({
			title: "Select moved worktree folder",
			defaultPath: defaultPath ?? undefined,
		});
		if (result.canceled || !result.path) {
			return;
		}

		try {
			await repairTrackedWorktree.mutateAsync({
				workspaceId,
				selectedPath: result.path,
			});
		} catch {
			// Mutation onError already surfaces the failure to the user.
		}
	};

	return {
		recoverTrackedWorktree,
		isPending: selectDirectory.isPending || repairTrackedWorktree.isPending,
	};
}
