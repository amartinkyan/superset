import type { SimpleGit } from "simple-git";
import {
	asLocalRef,
	asRemoteRef,
	type ResolvedRef,
	resolveDefaultBranchName,
} from "../../../../runtime/git/refs";

async function refExists(git: SimpleGit, fullRef: string): Promise<boolean> {
	try {
		await git.raw(["rev-parse", "--verify", "--quiet", `${fullRef}^{commit}`]);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve the best start point for a new worktree. Prefers a remote-tracking
 * ref (freshest code), falls back to a local branch, then HEAD.
 *
 * Probes use full refnames so a local branch literally named `origin/foo`
 * cannot be misclassified as remote-tracking. Callers switch on
 * `result.kind` — see `GIT_REFS.md`.
 */
export async function resolveStartPoint(
	git: SimpleGit,
	baseBranch: string | undefined,
): Promise<ResolvedRef> {
	const branch = baseBranch?.trim() || (await resolveDefaultBranchName(git));
	const remote = "origin";

	const remoteRef = asRemoteRef(remote, branch);
	if (await refExists(git, remoteRef)) {
		return {
			kind: "remote-tracking",
			fullRef: remoteRef,
			shortName: branch,
			remote,
			remoteShortName: `${remote}/${branch}`,
		};
	}

	const localRef = asLocalRef(branch);
	if (await refExists(git, localRef)) {
		return { kind: "local", fullRef: localRef, shortName: branch };
	}

	return { kind: "head" };
}
