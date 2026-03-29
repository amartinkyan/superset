import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";

const getCurrentBranchMock = mock(
	(async () => null) as (...args: unknown[]) => Promise<string | null>,
);
const execGitWithShellPathMock = mock((async () => ({
	stdout: "",
	stderr: "",
})) as (...args: unknown[]) => Promise<{ stdout: string; stderr: string }>);
const getRepoContextMock = mock(
	(async () => null) as (...args: unknown[]) => Promise<{
		isFork: boolean;
		repoUrl: string;
		upstreamUrl: string;
	} | null>,
);
const getPRForBranchMock = mock(
	(async () => null) as (...args: unknown[]) => Promise<{
		number: number;
		state: "open" | "closed" | "merged";
	} | null>,
);
const getPullRequestRepoArgsMock = mock(() => [] as string[]);
const execWithShellEnvMock = mock(
	(async () => undefined) as (...args: unknown[]) => Promise<void>,
);
const isNoPullRequestFoundMessageMock = mock(() => false);
const clearWorktreeStatusCachesMock = mock(() => undefined);
let mergePullRequest: typeof import("./merge-pull-request").mergePullRequest;

describe("mergePullRequest", () => {
	beforeAll(async () => {
		const gitModule = await import("../../workspaces/utils/git");
		const gitClientModule = await import("../../workspaces/utils/git-client");
		const githubModule = await import("../../workspaces/utils/github");
		const shellEnvModule = await import("../../workspaces/utils/shell-env");
		const gitUtilsModule = await import("../git-utils");
		const worktreeStatusCachesModule = await import("./worktree-status-caches");

		spyOn(gitModule, "getCurrentBranch").mockImplementation(((
			...args: Parameters<typeof gitModule.getCurrentBranch>
		) => getCurrentBranchMock(...args)) as typeof gitModule.getCurrentBranch);
		spyOn(gitModule, "isUnbornHeadError").mockImplementation(
			((error: unknown) =>
				error instanceof Error &&
				error.message.includes(
					"ambiguous argument 'HEAD'",
				)) as typeof gitModule.isUnbornHeadError,
		);
		spyOn(gitClientModule, "execGitWithShellPath").mockImplementation(((
			...args: Parameters<typeof gitClientModule.execGitWithShellPath>
		) =>
			execGitWithShellPathMock(
				...args,
			)) as typeof gitClientModule.execGitWithShellPath);
		spyOn(githubModule, "getPRForBranch").mockImplementation(((
			...args: Parameters<typeof githubModule.getPRForBranch>
		) => getPRForBranchMock(...args)) as typeof githubModule.getPRForBranch);
		spyOn(githubModule, "getPullRequestRepoArgs").mockImplementation(((
			...args: Parameters<typeof githubModule.getPullRequestRepoArgs>
		) =>
			getPullRequestRepoArgsMock(
				...args,
			)) as typeof githubModule.getPullRequestRepoArgs);
		spyOn(githubModule, "getRepoContext").mockImplementation(((
			...args: Parameters<typeof githubModule.getRepoContext>
		) => getRepoContextMock(...args)) as typeof githubModule.getRepoContext);
		spyOn(shellEnvModule, "execWithShellEnv").mockImplementation(((
			...args: Parameters<typeof shellEnvModule.execWithShellEnv>
		) =>
			execWithShellEnvMock(...args)) as typeof shellEnvModule.execWithShellEnv);
		spyOn(gitUtilsModule, "isNoPullRequestFoundMessage").mockImplementation(((
			...args: Parameters<typeof gitUtilsModule.isNoPullRequestFoundMessage>
		) =>
			isNoPullRequestFoundMessageMock(
				...args,
			)) as typeof gitUtilsModule.isNoPullRequestFoundMessage);
		spyOn(
			worktreeStatusCachesModule,
			"clearWorktreeStatusCaches",
		).mockImplementation(((
			...args: Parameters<
				typeof worktreeStatusCachesModule.clearWorktreeStatusCaches
			>
		) =>
			clearWorktreeStatusCachesMock(
				...args,
			)) as typeof worktreeStatusCachesModule.clearWorktreeStatusCaches);

		({ mergePullRequest } = await import("./merge-pull-request"));
	});

	afterAll(() => {
		mock.restore();
	});

	beforeEach(() => {
		getCurrentBranchMock.mockReset();
		getCurrentBranchMock.mockResolvedValue(null);
		execGitWithShellPathMock.mockReset();
		execGitWithShellPathMock.mockResolvedValue({
			stdout: "abc123\n",
			stderr: "",
		});
		getRepoContextMock.mockReset();
		getRepoContextMock.mockResolvedValue({
			isFork: false,
			repoUrl: "https://github.com/superset-sh/superset",
			upstreamUrl: "https://github.com/superset-sh/superset",
		});
		getPRForBranchMock.mockReset();
		getPRForBranchMock.mockResolvedValue(null);
		getPullRequestRepoArgsMock.mockReset();
		getPullRequestRepoArgsMock.mockReturnValue([]);
		execWithShellEnvMock.mockReset();
		execWithShellEnvMock.mockResolvedValue(undefined);
		isNoPullRequestFoundMessageMock.mockReset();
		isNoPullRequestFoundMessageMock.mockReturnValue(false);
		clearWorktreeStatusCachesMock.mockReset();
	});

	test("falls back to legacy gh merge when HEAD is detached", async () => {
		const result = await mergePullRequest({
			worktreePath: "/tmp/detached-worktree",
			strategy: "squash",
		});

		expect(getRepoContextMock).toHaveBeenCalledWith("/tmp/detached-worktree");
		expect(getCurrentBranchMock).toHaveBeenCalledWith("/tmp/detached-worktree");
		expect(execGitWithShellPathMock).not.toHaveBeenCalled();
		expect(getPRForBranchMock).not.toHaveBeenCalled();
		expect(execWithShellEnvMock).toHaveBeenCalledWith(
			"gh",
			["pr", "merge", "--squash"],
			{ cwd: "/tmp/detached-worktree" },
		);
		expect(clearWorktreeStatusCachesMock).toHaveBeenCalledWith(
			"/tmp/detached-worktree",
		);
		expect(result.success).toBe(true);
		expect(Number.isNaN(Date.parse(result.mergedAt))).toBe(false);
	});

	test("resolves the PR by branch when HEAD has no commit yet", async () => {
		getCurrentBranchMock.mockResolvedValue("feature/unborn");
		execGitWithShellPathMock.mockRejectedValueOnce(
			new Error("fatal: ambiguous argument 'HEAD'"),
		);
		getPRForBranchMock.mockResolvedValue({
			number: 42,
			state: "open",
		});

		const result = await mergePullRequest({
			worktreePath: "/tmp/unborn-worktree",
			strategy: "rebase",
		});

		expect(execWithShellEnvMock).toHaveBeenCalledWith(
			"gh",
			["pr", "merge", "42", "--rebase"],
			{ cwd: "/tmp/unborn-worktree" },
		);
		expect(getPRForBranchMock).toHaveBeenCalledWith(
			"/tmp/unborn-worktree",
			"feature/unborn",
			{
				isFork: false,
				repoUrl: "https://github.com/superset-sh/superset",
				upstreamUrl: "https://github.com/superset-sh/superset",
			},
			undefined,
		);
		expect(result.success).toBe(true);
	});

	test("falls back to legacy merge on unexpected HEAD lookup failures", async () => {
		getCurrentBranchMock.mockResolvedValue("feature/branch");
		execGitWithShellPathMock.mockRejectedValueOnce(
			new Error("fatal: permission denied"),
		);

		const result = await mergePullRequest({
			worktreePath: "/tmp/broken-worktree",
			strategy: "merge",
		});

		expect(getPRForBranchMock).not.toHaveBeenCalled();
		expect(execWithShellEnvMock).toHaveBeenCalledWith(
			"gh",
			["pr", "merge", "--merge"],
			{ cwd: "/tmp/broken-worktree" },
		);
		expect(result.success).toBe(true);
	});
});
