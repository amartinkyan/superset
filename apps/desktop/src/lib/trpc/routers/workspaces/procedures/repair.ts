import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../../..";
import { getWorkspace } from "../utils/db-helpers";
import { repairTrackedWorktreePath as repairTrackedWorktreePathUtil } from "../utils/repair-worktree-path";

export const createRepairProcedures = () => {
	return router({
		repairTrackedWorktreePath: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					selectedPath: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				const workspace = getWorkspace(input.workspaceId);
				if (!workspace) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: `Workspace ${input.workspaceId} not found`,
					});
				}

				if (workspace.type !== "worktree" || !workspace.worktreeId) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Only tracked worktree workspaces can be repaired",
					});
				}

				return repairTrackedWorktreePathUtil({
					worktreeId: workspace.worktreeId,
					selectedPath: input.selectedPath,
				});
			}),
	});
};
