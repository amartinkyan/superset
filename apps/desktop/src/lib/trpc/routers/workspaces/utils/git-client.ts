import {
	type ExecFileOptionsWithStringEncoding,
	execFile,
} from "node:child_process";
import { promisify } from "node:util";
import simpleGit, { type SimpleGit } from "simple-git";
import { getProcessEnvWithShellPath } from "./shell-env";

const execFileAsync = promisify(execFile);

export async function getSimpleGitWithShellPath(
	repoPath?: string,
): Promise<SimpleGit> {
	const git = repoPath ? simpleGit(repoPath) : simpleGit();
	git.env(await getProcessEnvWithShellPath());
	return git;
}

export class GitNotFoundError extends Error {
	constructor(cause?: unknown) {
		super(
			"Git is not installed or could not be found on your PATH. " +
				"Please install Git and ensure it is available in your system PATH.\n" +
				"  - macOS: Install via Xcode Command Line Tools (xcode-select --install) or Homebrew (brew install git)\n" +
				"  - Windows: Download from https://git-scm.com/download/win\n" +
				"  - Linux: Install via your package manager (e.g. apt install git)",
		);
		this.name = "GitNotFoundError";
		this.cause = cause;
	}
}

export async function execGitWithShellPath(
	args: string[],
	options?: Omit<ExecFileOptionsWithStringEncoding, "encoding">,
): Promise<{ stdout: string; stderr: string }> {
	const env = await getProcessEnvWithShellPath(
		options?.env ? { ...process.env, ...options.env } : process.env,
	);

	try {
		return await execFileAsync("git", args, {
			...options,
			encoding: "utf8",
			env,
		});
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			throw new GitNotFoundError(error);
		}
		throw error;
	}
}
