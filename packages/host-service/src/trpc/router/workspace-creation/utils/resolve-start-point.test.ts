import { describe, expect, mock, test } from "bun:test";
import { resolveStartPoint } from "./resolve-start-point";

/**
 * Mock git that knows about a set of FULL refnames (e.g. `refs/heads/main`,
 * `refs/remotes/origin/main`). Mirrors how `resolveStartPoint` probes.
 */
function createMockGit(existingFullRefs: Set<string>, defaultBranch?: string) {
	return {
		raw: mock(async (args: string[]) => {
			if (args[0] === "rev-parse" && args[1] === "--verify") {
				const ref = args[3]?.replace("^{commit}", "") ?? "";
				if (existingFullRefs.has(ref)) return "";
				throw new Error("fatal: Needed a single revision");
			}
			if (
				args[0] === "symbolic-ref" &&
				args[1] === "refs/remotes/origin/HEAD"
			) {
				if (defaultBranch) return `origin/${defaultBranch}`;
				throw new Error(
					"fatal: ref refs/remotes/origin/HEAD is not a symbolic ref",
				);
			}
			throw new Error(`Unexpected raw args: ${args.join(" ")}`);
		}),
	} as never;
}

describe("resolveStartPoint", () => {
	test("prefers origin/<branch> when it exists", async () => {
		const git = createMockGit(
			new Set(["refs/remotes/origin/main", "refs/heads/main"]),
		);
		const result = await resolveStartPoint(git, "main");

		expect(result.kind).toBe("remote-tracking");
		if (result.kind === "remote-tracking") {
			expect(result.shortName).toBe("main");
			expect(result.remote).toBe("origin");
			expect(result.fullRef).toBe("refs/remotes/origin/main");
		}
	});

	test("falls back to local branch when origin/<branch> missing", async () => {
		const git = createMockGit(new Set(["refs/heads/main"]));
		const result = await resolveStartPoint(git, "main");

		expect(result.kind).toBe("local");
		if (result.kind === "local") {
			expect(result.shortName).toBe("main");
			expect(result.fullRef).toBe("refs/heads/main");
		}
	});

	test("falls back to HEAD when neither exists", async () => {
		const git = createMockGit(new Set());
		const result = await resolveStartPoint(git, "main");

		expect(result.kind).toBe("head");
	});

	test("works with explicit branch name", async () => {
		const git = createMockGit(
			new Set(["refs/remotes/origin/develop", "refs/heads/develop"]),
		);
		const result = await resolveStartPoint(git, "develop");

		expect(result.kind).toBe("remote-tracking");
		if (result.kind === "remote-tracking") {
			expect(result.shortName).toBe("develop");
			expect(result.remoteShortName).toBe("origin/develop");
		}
	});

	test("resolves default branch via symbolic-ref when baseBranch not provided", async () => {
		const git = createMockGit(
			new Set(["refs/remotes/origin/master", "refs/heads/master"]),
			"master",
		);
		const result = await resolveStartPoint(git, undefined);

		expect(result.kind).toBe("remote-tracking");
		if (result.kind === "remote-tracking") {
			expect(result.shortName).toBe("master");
		}
	});

	test("defaults to 'main' when symbolic-ref fails and baseBranch not provided", async () => {
		const git = createMockGit(new Set(["refs/remotes/origin/main"]));
		const result = await resolveStartPoint(git, undefined);

		expect(result.kind).toBe("remote-tracking");
		if (result.kind === "remote-tracking") {
			expect(result.shortName).toBe("main");
		}
	});

	test("falls back to HEAD when symbolic-ref fails and no default branch exists", async () => {
		const git = createMockGit(new Set());
		const result = await resolveStartPoint(git, undefined);

		expect(result.kind).toBe("head");
	});

	test("handles empty/whitespace baseBranch as undefined", async () => {
		const git = createMockGit(new Set(["refs/remotes/origin/main"]));
		const result = await resolveStartPoint(git, "  ");

		expect(result.kind).toBe("remote-tracking");
		if (result.kind === "remote-tracking") {
			expect(result.shortName).toBe("main");
		}
	});

	// Regression: a local branch literally named `origin/foo` must classify
	// as `local`, not `remote-tracking`. Previously `ref.startsWith("origin/")`
	// got this wrong.
	test("local branch named origin/foo classifies as local, not remote-tracking", async () => {
		const git = createMockGit(new Set(["refs/heads/origin/foo"]));
		const result = await resolveStartPoint(git, "origin/foo");

		expect(result.kind).toBe("local");
		if (result.kind === "local") {
			expect(result.shortName).toBe("origin/foo");
			expect(result.fullRef).toBe("refs/heads/origin/foo");
		}
	});
});
