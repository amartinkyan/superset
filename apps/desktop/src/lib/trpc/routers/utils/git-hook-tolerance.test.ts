import { describe, expect, test } from "bun:test";
import {
	extractGitHookOutput,
	isPreCommitHookFailure,
	runWithPostCheckoutHookTolerance,
} from "./git-hook-tolerance";

describe("isPreCommitHookFailure", () => {
	test("detects pre-commit keyword in error message", () => {
		const error = new Error(
			"husky - pre-commit hook exited with code 1 (error)",
		);
		expect(isPreCommitHookFailure(error)).toBe(true);
	});

	test("detects pre-commit hook failure from stderr", () => {
		const error = Object.assign(new Error("git commit failed"), {
			stderr:
				"hint: The '.husky/pre-commit' hook was ignored because it's not set as executable.",
		});
		expect(isPreCommitHookFailure(error)).toBe(true);
	});

	test("detects husky + hook failure without pre-commit keyword", () => {
		const error = Object.assign(new Error("Command failed"), {
			stderr: "husky - hook failed with exit code 1",
		});
		expect(isPreCommitHookFailure(error)).toBe(true);
	});

	test("detects lint-staged hook failure", () => {
		const error = Object.assign(new Error("Command failed"), {
			stderr: "lint-staged failed\nhook returned non-zero exit code",
		});
		expect(isPreCommitHookFailure(error)).toBe(true);
	});

	test("does not match post-checkout hook failures", () => {
		const error = Object.assign(new Error("post-checkout hook failed"), {
			stderr: "husky - post-checkout hook exited with code 1",
		});
		expect(isPreCommitHookFailure(error)).toBe(false);
	});

	test("does not match generic git errors", () => {
		const error = new Error("fatal: not a git repository");
		expect(isPreCommitHookFailure(error)).toBe(false);
	});

	test("does not match merge conflict errors", () => {
		const error = new Error(
			"CONFLICT (content): Merge conflict in src/file.ts",
		);
		expect(isPreCommitHookFailure(error)).toBe(false);
	});
});

describe("extractGitHookOutput", () => {
	test("includes message, stderr, and stdout from git error", () => {
		const error = Object.assign(
			new Error("husky - pre-commit hook exited with code 1"),
			{
				stderr: "eslint found 3 errors",
				stdout: "Running lint-staged...\nsrc/file.ts: error",
			},
		);
		const output = extractGitHookOutput(error);
		expect(output).toContain("husky - pre-commit hook exited with code 1");
		expect(output).toContain("eslint found 3 errors");
		expect(output).toContain("Running lint-staged...");
		expect(output).toContain("src/file.ts: error");
	});

	test("returns message-only when stderr/stdout are empty", () => {
		const error = new Error("pre-commit hook failed");
		const output = extractGitHookOutput(error);
		expect(output).toBe("pre-commit hook failed");
	});

	test("returns null for empty error text", () => {
		const output = extractGitHookOutput("");
		expect(output).toBeNull();
	});

	test("handles non-Error objects", () => {
		const output = extractGitHookOutput("pre-commit hook failed");
		expect(output).toBe("pre-commit hook failed");
	});
});

describe("runWithPostCheckoutHookTolerance", () => {
	test("treats post-checkout hook failures as non-fatal when operation succeeded", async () => {
		const hookError = Object.assign(
			new Error("husky - post-checkout script failed"),
			{
				stderr: "husky - command not found in PATH=...",
			},
		);

		await expect(
			runWithPostCheckoutHookTolerance({
				context: "Switched branch",
				run: async () => {
					throw hookError;
				},
				didSucceed: async () => true,
			}),
		).resolves.toBeUndefined();
	});

	test("re-throws hook failures when operation did not succeed", async () => {
		const hookError = new Error("post-checkout hook failed");

		await expect(
			runWithPostCheckoutHookTolerance({
				context: "Switched branch",
				run: async () => {
					throw hookError;
				},
				didSucceed: async () => false,
			}),
		).rejects.toThrow("post-checkout");
	});

	test("re-throws non-hook failures", async () => {
		const genericError = new Error("fatal: '../worktree' already exists");

		await expect(
			runWithPostCheckoutHookTolerance({
				context: "Created worktree",
				run: async () => {
					throw genericError;
				},
				didSucceed: async () => true,
			}),
		).rejects.toThrow("already exists");
	});
});
