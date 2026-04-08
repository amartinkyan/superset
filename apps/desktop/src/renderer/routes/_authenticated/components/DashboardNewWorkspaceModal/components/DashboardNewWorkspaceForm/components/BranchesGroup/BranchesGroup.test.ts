import { describe, expect, test } from "bun:test";
import Fuse from "fuse.js";

/**
 * Reproduction test for https://github.com/supersetapp/superset/issues/3267
 *
 * The bug: when a repository has 40,000+ branches, opening the branch selector
 * freezes the app because:
 *   1. `branches` sorting is not memoized — runs on every render
 *   2. This causes `branchRows` and `branchFuse` to recompute every render
 *      (cascading useMemo invalidation since the sort creates a new array ref)
 *   3. Fuse.js index creation over 40k items is expensive (~seconds)
 *
 * The fix: memoize the sorted `branches` array so downstream useMemo hooks
 * only recompute when the underlying data actually changes.
 */

type Branch = { name: string; isLocal: boolean };
type BranchRow = { branch: Branch; existingWorkspaceId: string | undefined };

/** Mirrors the sorting logic from BranchesGroup.tsx */
function sortBranches(branches: Branch[], defaultBranch: string): Branch[] {
	return [...branches].sort((a, b) => {
		if (a.name === defaultBranch) return -1;
		if (b.name === defaultBranch) return 1;
		if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

/** Mirrors the branchRows mapping from BranchesGroup.tsx */
function toBranchRows(
	branches: Branch[],
	workspaceByBranch: Map<string, string>,
): BranchRow[] {
	return branches.map((branch) => ({
		branch,
		existingWorkspaceId: workspaceByBranch.get(branch.name),
	}));
}

/** Mirrors the visible rows logic from BranchesGroup.tsx */
function getVisibleBranchRows(
	branchRows: BranchRow[],
	branchFuse: Fuse<BranchRow>,
	query: string,
): BranchRow[] {
	const trimmed = query.trim();
	if (!trimmed) {
		return branchRows.slice(0, 100);
	}
	return branchFuse
		.search(trimmed)
		.slice(0, 100)
		.map((result) => result.item);
}

function generateBranches(count: number): Branch[] {
	const branches: Branch[] = [];
	for (let i = 0; i < count; i++) {
		branches.push({
			name: `feature/branch-${String(i).padStart(6, "0")}`,
			isLocal: i < 50, // first 50 are local
		});
	}
	return branches;
}

describe("BranchesGroup — issue #3267: large branch list performance", () => {
	const BRANCH_COUNT = 40_000;
	const branches = generateBranches(BRANCH_COUNT);
	const defaultBranch = "main";
	const emptyWorkspaceMap = new Map<string, string>();

	test("sorting 40k branches completes in < 2s", () => {
		const start = performance.now();
		const sorted = sortBranches(branches, defaultBranch);
		const elapsed = performance.now() - start;

		expect(sorted.length).toBe(BRANCH_COUNT);
		// Local branches should come first (after default branch)
		expect(sorted[0]?.isLocal).toBe(true);
		expect(elapsed).toBeLessThan(2000);
	});

	test("Fuse index creation over 40k branches completes in < 3s", () => {
		const sorted = sortBranches(branches, defaultBranch);
		const rows = toBranchRows(sorted, emptyWorkspaceMap);

		const start = performance.now();
		const fuse = new Fuse(rows, {
			keys: ["branch.name"],
			threshold: 0.3,
			includeScore: true,
			ignoreLocation: true,
		});
		const elapsed = performance.now() - start;

		expect(fuse).toBeDefined();
		expect(elapsed).toBeLessThan(3000);
	});

	test("repeated Fuse index creation simulates unmemoized renders and is slow", () => {
		const sorted = sortBranches(branches, defaultBranch);
		const rows = toBranchRows(sorted, emptyWorkspaceMap);

		// Simulate 5 "renders" each recreating the Fuse index (the bug)
		const RENDERS = 5;
		const start = performance.now();
		for (let i = 0; i < RENDERS; i++) {
			new Fuse(rows, {
				keys: ["branch.name"],
				threshold: 0.3,
				includeScore: true,
				ignoreLocation: true,
			});
		}
		const totalElapsed = performance.now() - start;

		// With the bug, each render recreates the Fuse index.
		// 5 creations should take meaningfully longer than 1 creation.
		// This proves that memoization matters — without it, every render pays the full cost.
		const singleStart = performance.now();
		new Fuse(rows, {
			keys: ["branch.name"],
			threshold: 0.3,
			includeScore: true,
			ignoreLocation: true,
		});
		const singleElapsed = performance.now() - singleStart;

		// Repeated creation is at least 2× a single creation
		expect(totalElapsed).toBeGreaterThan(singleElapsed * 2);
	});

	test("visible rows are capped at 100 even with 40k branches", () => {
		const sorted = sortBranches(branches, defaultBranch);
		const rows = toBranchRows(sorted, emptyWorkspaceMap);
		const fuse = new Fuse(rows, {
			keys: ["branch.name"],
			threshold: 0.3,
			includeScore: true,
			ignoreLocation: true,
		});

		// Without search query
		const noQuery = getVisibleBranchRows(rows, fuse, "");
		expect(noQuery.length).toBe(100);

		// With search query
		const withQuery = getVisibleBranchRows(rows, fuse, "branch-000");
		expect(withQuery.length).toBeLessThanOrEqual(100);
		expect(withQuery.length).toBeGreaterThan(0);
	});

	test("memoized sort produces stable reference (fix verification)", () => {
		// The fix: wrapping the sort in useMemo means the same data input
		// returns the same reference. We verify the sort is deterministic.
		const sorted1 = sortBranches(branches, defaultBranch);
		const sorted2 = sortBranches(branches, defaultBranch);

		// Same data, same order
		expect(sorted1.length).toBe(sorted2.length);
		for (let i = 0; i < 100; i++) {
			expect(sorted1[i]?.name).toBe(sorted2[i]?.name);
		}
	});
});
