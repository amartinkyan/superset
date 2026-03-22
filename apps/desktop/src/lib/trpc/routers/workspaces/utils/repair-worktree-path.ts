import { existsSync, realpathSync } from "node:fs";
import { projects, type SelectWorktree, worktrees } from "@superset/local-db";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { localDb } from "main/lib/local-db";
import {
	getBranchWorktreePath,
	getCurrentBranch,
	getGitRoot,
	repairWorktreeRegistration,
} from "./git";

export type ResolveTrackedWorktreePathResult =
	| {
			status: "resolved";
			path: string;
	  }
	| {
			status: "git_repair_required";
			branch: string;
			mainRepoPath: string;
			registeredPath: string | null;
			storedPath: string;
	  }
	| {
			status: "missing";
	  };

export type TrackedWorktreeRepairState = "ok" | "missing" | "repair_required";

interface TrackedWorktreeContext {
	mainRepoPath: string;
	worktree: SelectWorktree;
}

interface ResolveTrackedWorktreePathWithMetadataResult {
	pathChanged: boolean;
	resolution: ResolveTrackedWorktreePathResult;
}

function safeRealpath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

function getTrackedWorktreeContext(
	worktreeId: string,
): TrackedWorktreeContext | null {
	const worktree = localDb
		.select()
		.from(worktrees)
		.where(eq(worktrees.id, worktreeId))
		.get();
	if (!worktree) {
		return null;
	}

	const project = localDb
		.select()
		.from(projects)
		.where(eq(projects.id, worktree.projectId))
		.get();
	if (!project) {
		return null;
	}

	return {
		mainRepoPath: project.mainRepoPath,
		worktree,
	};
}

function isMainRepoPath(
	context: TrackedWorktreeContext,
	candidatePath: string,
): boolean {
	return safeRealpath(candidatePath) === safeRealpath(context.mainRepoPath);
}

function persistResolvedTrackedWorktreePath(input: {
	context: TrackedWorktreeContext;
	resolvedPath: string;
}): ResolveTrackedWorktreePathWithMetadataResult {
	if (isMainRepoPath(input.context, input.resolvedPath)) {
		return {
			pathChanged: false,
			resolution: { status: "missing" },
		};
	}

	const pathChanged = input.resolvedPath !== input.context.worktree.path;
	if (pathChanged) {
		localDb
			.update(worktrees)
			.set({ path: input.resolvedPath })
			.where(eq(worktrees.id, input.context.worktree.id))
			.run();
	}

	return {
		pathChanged,
		resolution: {
			status: "resolved",
			path: input.resolvedPath,
		},
	};
}

export function getTrackedWorktreeRepairCommand(mainRepoPath: string): string {
	return `git -C "${mainRepoPath}" worktree repair <new-path>`;
}

export function getTrackedWorktreeRepairMessage(input: {
	branch: string;
	mainRepoPath: string;
}): string {
	return `Worktree branch "${input.branch}" is missing at its tracked path. Select the moved worktree folder and Superset will repair it, or run ${getTrackedWorktreeRepairCommand(input.mainRepoPath)} manually.`;
}

async function resolveTrackedWorktreePathWithMetadata(
	worktreeId: string,
): Promise<ResolveTrackedWorktreePathWithMetadataResult> {
	const context = getTrackedWorktreeContext(worktreeId);
	if (!context) {
		return {
			pathChanged: false,
			resolution: { status: "missing" },
		};
	}

	if (existsSync(context.worktree.path)) {
		return {
			pathChanged: false,
			resolution: {
				status: "resolved",
				path: context.worktree.path,
			},
		};
	}

	let registeredPath: string | null = null;
	try {
		registeredPath = await getBranchWorktreePath({
			mainRepoPath: context.mainRepoPath,
			branch: context.worktree.branch,
		});
	} catch (error) {
		console.warn(
			`[repair-worktree-path] Failed to inspect Git worktree state for ${context.worktree.id}:`,
			error instanceof Error ? error.message : error,
		);
	}

	if (
		registeredPath &&
		existsSync(registeredPath) &&
		!isMainRepoPath(context, registeredPath)
	) {
		return persistResolvedTrackedWorktreePath({
			context,
			resolvedPath: registeredPath,
		});
	}

	return {
		pathChanged: false,
		resolution: {
			status: "git_repair_required",
			branch: context.worktree.branch,
			mainRepoPath: context.mainRepoPath,
			registeredPath,
			storedPath: context.worktree.path,
		},
	};
}

export async function resolveTrackedWorktreePath(
	worktreeId: string,
): Promise<ResolveTrackedWorktreePathResult> {
	const resolution = await resolveTrackedWorktreePathWithMetadata(worktreeId);
	return resolution.resolution;
}

export async function resolveWorktreePathOrThrow(
	worktreeId: string,
): Promise<string | null> {
	const resolution = await resolveTrackedWorktreePathWithMetadata(worktreeId);

	if (resolution.resolution.status === "resolved") {
		return resolution.resolution.path;
	}

	if (resolution.resolution.status === "git_repair_required") {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: getTrackedWorktreeRepairMessage({
				branch: resolution.resolution.branch,
				mainRepoPath: resolution.resolution.mainRepoPath,
			}),
			cause: {
				reason: "git_repair_required",
				branch: resolution.resolution.branch,
				mainRepoPath: resolution.resolution.mainRepoPath,
				registeredPath: resolution.resolution.registeredPath,
				storedPath: resolution.resolution.storedPath,
				command: getTrackedWorktreeRepairCommand(
					resolution.resolution.mainRepoPath,
				),
			},
		});
	}

	return null;
}

export async function resolveWorktreePathOrThrowWithMetadata(
	worktreeId: string,
): Promise<{
	path: string | null;
	pathChanged: boolean;
}> {
	const resolution = await resolveTrackedWorktreePathWithMetadata(worktreeId);

	if (resolution.resolution.status === "resolved") {
		return {
			path: resolution.resolution.path,
			pathChanged: resolution.pathChanged,
		};
	}

	if (resolution.resolution.status === "git_repair_required") {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: getTrackedWorktreeRepairMessage({
				branch: resolution.resolution.branch,
				mainRepoPath: resolution.resolution.mainRepoPath,
			}),
			cause: {
				reason: "git_repair_required",
				branch: resolution.resolution.branch,
				mainRepoPath: resolution.resolution.mainRepoPath,
				registeredPath: resolution.resolution.registeredPath,
				storedPath: resolution.resolution.storedPath,
				command: getTrackedWorktreeRepairCommand(
					resolution.resolution.mainRepoPath,
				),
			},
		});
	}

	return { path: null, pathChanged: false };
}

export async function resolveWorktreePathWithRepair(
	worktreeId: string,
): Promise<string | null> {
	const resolution = await resolveTrackedWorktreePathWithMetadata(worktreeId);
	return resolution.resolution.status === "resolved"
		? resolution.resolution.path
		: null;
}

export async function resolveWorktreePathWithRepairMetadata(
	worktreeId: string,
): Promise<{
	path: string | null;
	pathChanged: boolean;
	repairState: TrackedWorktreeRepairState;
	repairMessage: string | null;
	repairCommand: string | null;
}> {
	const resolution = await resolveTrackedWorktreePathWithMetadata(worktreeId);

	if (resolution.resolution.status === "resolved") {
		return {
			path: resolution.resolution.path,
			pathChanged: resolution.pathChanged,
			repairState: "ok",
			repairMessage: null,
			repairCommand: null,
		};
	}

	if (resolution.resolution.status === "git_repair_required") {
		return {
			path: null,
			pathChanged: false,
			repairState: "repair_required",
			repairMessage: getTrackedWorktreeRepairMessage({
				branch: resolution.resolution.branch,
				mainRepoPath: resolution.resolution.mainRepoPath,
			}),
			repairCommand: getTrackedWorktreeRepairCommand(
				resolution.resolution.mainRepoPath,
			),
		};
	}

	return {
		path: null,
		pathChanged: false,
		repairState: "missing",
		repairMessage: "Tracked worktree could not be found.",
		repairCommand: null,
	};
}

export async function repairTrackedWorktreePath(input: {
	worktreeId: string;
	selectedPath: string;
}): Promise<{
	path: string;
	pathChanged: boolean;
}> {
	const context = getTrackedWorktreeContext(input.worktreeId);
	if (!context) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Tracked worktree ${input.worktreeId} not found`,
		});
	}

	let candidatePath: string;
	try {
		candidatePath = await getGitRoot(input.selectedPath);
	} catch (error) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				error instanceof Error
					? error.message
					: "Selected path is not a Git worktree",
		});
	}

	if (!existsSync(candidatePath)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Selected worktree path does not exist on disk",
		});
	}

	if (isMainRepoPath(context, candidatePath)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Select the moved worktree folder, not the main repository",
		});
	}

	const currentBranch = await getCurrentBranch(candidatePath);
	if (currentBranch !== context.worktree.branch) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: `Selected folder is on branch "${currentBranch ?? "detached"}", expected "${context.worktree.branch}"`,
		});
	}

	await repairWorktreeRegistration({
		mainRepoPath: context.mainRepoPath,
		worktreePath: candidatePath,
	});

	const repairedPath = await getBranchWorktreePath({
		mainRepoPath: context.mainRepoPath,
		branch: context.worktree.branch,
	});

	if (
		!repairedPath ||
		!existsSync(repairedPath) ||
		isMainRepoPath(context, repairedPath)
	) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Git could not confirm the repaired worktree path",
		});
	}

	const persisted = persistResolvedTrackedWorktreePath({
		context,
		resolvedPath: repairedPath,
	});

	if (persisted.resolution.status !== "resolved") {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Failed to persist repaired worktree path",
		});
	}

	return {
		path: persisted.resolution.path,
		pathChanged: persisted.pathChanged,
	};
}
