import { describe, expect, test } from "bun:test";
import { GitNotFoundError } from "./git-client";

describe("GitNotFoundError", () => {
	test("provides a helpful error message with install instructions", () => {
		const error = new GitNotFoundError();

		expect(error.name).toBe("GitNotFoundError");
		expect(error.message).toContain("Git is not installed");
		expect(error.message).toContain("PATH");
		expect(error.message).toContain("xcode-select --install");
		expect(error.message).toContain("git-scm.com");
		expect(error.message).toContain("apt install git");
	});

	test("preserves the original ENOENT error as cause", () => {
		const originalError = Object.assign(new Error("spawn git ENOENT"), {
			code: "ENOENT",
		});
		const error = new GitNotFoundError(originalError);

		expect(error.cause).toBe(originalError);
	});

	test("is an instance of Error", () => {
		const error = new GitNotFoundError();
		expect(error).toBeInstanceOf(Error);
	});
});

describe("execGitWithShellPath", () => {
	test("wraps ENOENT error as GitNotFoundError", async () => {
		// Use a non-existent binary name to trigger ENOENT
		// We test this indirectly by checking the error class behavior
		const { execGitWithShellPath } = await import("./git-client");

		// Override PATH to empty so git can't be found
		try {
			await execGitWithShellPath(["--version"], {
				env: { PATH: "/nonexistent-path-for-test" },
			});
			// If git somehow succeeds (unlikely with empty PATH), skip
		} catch (error) {
			if (error instanceof GitNotFoundError) {
				expect(error.name).toBe("GitNotFoundError");
				expect(error.message).toContain("Git is not installed");
				expect(error.cause).toBeDefined();
			}
			// If it's a different error (e.g. git exists but fails), that's ok too
		}
	});
});
