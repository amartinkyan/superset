import { describe, expect, test } from "bun:test";
import { gitHubStatusSchema } from "@superset/local-db";
import { GHPRResponseSchema } from "./types";

describe("baseRefName in PR schemas", () => {
	test("GHPRResponseSchema accepts baseRefName field from gh CLI output", () => {
		const ghCliOutput = {
			number: 42,
			title: "My PR",
			url: "https://github.com/owner/repo/pull/42",
			state: "OPEN",
			isDraft: false,
			mergedAt: null,
			additions: 10,
			deletions: 5,
			headRefOid: "abc123",
			headRefName: "feature-branch",
			baseRefName: "main",
			headRepository: { name: "repo" },
			headRepositoryOwner: { login: "owner" },
			isCrossRepository: false,
			reviewDecision: "APPROVED",
			statusCheckRollup: [],
			reviewRequests: [],
		};

		const result = GHPRResponseSchema.safeParse(ghCliOutput);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.baseRefName).toBe("main");
		}
	});

	test("gitHubStatusSchema accepts baseRefName in PR object", () => {
		const status = {
			pr: {
				number: 42,
				title: "My PR",
				url: "https://github.com/owner/repo/pull/42",
				state: "open" as const,
				additions: 10,
				deletions: 5,
				headRefName: "feature-branch",
				baseRefName: "develop",
				headRepositoryOwner: "owner",
				headRepositoryName: "repo",
				isCrossRepository: false,
				reviewDecision: "approved" as const,
				checksStatus: "success" as const,
				checks: [],
			},
			repoUrl: "https://github.com/owner/repo",
			branchExistsOnRemote: true,
			lastRefreshed: Date.now(),
		};

		const result = gitHubStatusSchema.safeParse(status);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.pr?.baseRefName).toBe("develop");
		}
	});

	test("baseRefName is optional in gitHubStatusSchema for backward compatibility", () => {
		const status = {
			pr: {
				number: 42,
				title: "My PR",
				url: "https://github.com/owner/repo/pull/42",
				state: "open" as const,
				additions: 10,
				deletions: 5,
				reviewDecision: "approved" as const,
				checksStatus: "success" as const,
				checks: [],
			},
			repoUrl: "https://github.com/owner/repo",
			branchExistsOnRemote: true,
			lastRefreshed: Date.now(),
		};

		const result = gitHubStatusSchema.safeParse(status);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.pr?.baseRefName).toBeUndefined();
		}
	});

	test("detects base branch mismatch when PR target changes", () => {
		const storedBaseBranch: string | null = "main";
		const prBaseRefName: string | undefined = "develop";

		const baseBranchChanged =
			prBaseRefName && storedBaseBranch && prBaseRefName !== storedBaseBranch;

		expect(baseBranchChanged).toBe(true);
	});

	test("no mismatch when PR target matches stored base branch", () => {
		const storedBaseBranch: string | null = "main";
		const prBaseRefName: string | undefined = "main";

		const baseBranchChanged =
			prBaseRefName && storedBaseBranch && prBaseRefName !== storedBaseBranch;

		expect(baseBranchChanged).toBe(false);
	});

	test("no sync when stored base branch is null (new worktree)", () => {
		const storedBaseBranch = null;
		const prBaseRefName = "main";

		const baseBranchChanged =
			prBaseRefName && storedBaseBranch && prBaseRefName !== storedBaseBranch;

		expect(baseBranchChanged).toBeFalsy();
	});

	test("no sync when PR has no baseRefName (legacy cached data)", () => {
		const storedBaseBranch = "main";
		const prBaseRefName = undefined;

		const baseBranchChanged =
			prBaseRefName && storedBaseBranch && prBaseRefName !== storedBaseBranch;

		expect(baseBranchChanged).toBeFalsy();
	});
});
