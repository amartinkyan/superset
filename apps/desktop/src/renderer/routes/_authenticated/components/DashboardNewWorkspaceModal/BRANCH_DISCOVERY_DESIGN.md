# V2 Branch Discovery — Design

Scope: the branch picker in the v2 new-workspace modal. Handles browsing + selecting a branch, plus dispatching direct actions (Check out, Open existing) on rows that have them.

## Data shape

One procedure — `workspaceCreation.searchBranches` — returns everything the UI needs per row:

```ts
input: {
  projectId: string;
  query?: string;                              // server-side substring
  cursor?: string;                             // opaque (offset-encoded)
  limit?: number;                              // default 50, max 200
  refresh?: boolean;                           // triggers `git fetch --prune`, TTL-gated
  filter?: "branch" | "worktree";              // server-side filter; default = "branch"
}

output: {
  defaultBranch: string | null;
  items: BranchRow[];
  nextCursor: string | null;
}

type BranchRow = {
  name: string;
  lastCommitDate: number;
  isLocal: boolean;
  isRemote: boolean;
  recency: number | null;       // reflog ordinal, 0 = most recent
  worktreePath: string | null;  // only Superset worktrees under <repo>/.worktrees/
  isCheckedOut: boolean;        // true if in any git worktree (incl. primary)
};
```

Rationale for one procedure with rich metadata: worktrees aren't a separate searchable surface — they're a filter + decoration on the same branch list. Single source of truth, one invalidation trigger, no flicker.

## Server flow

1. If `refresh`, `git fetch --prune --quiet --no-tags` (30s TTL per project — prevents keystroke thrash).
2. `git for-each-ref --sort=-committerdate refs/heads/ refs/remotes/origin/` — one call, ~20ms on 10k refs.
3. `git worktree list --porcelain` → split into `worktreeMap` (Superset-managed only, under `.worktrees/`) and `checkedOutBranches` (any worktree, incl. primary).
4. `git log -g --pretty=%gs --grep-reflog=checkout: -n 500` → reflog ordinal map.
5. Collapse local+remote pairs; apply `filter` (`branch` = `!worktreeMap.has`, `worktree` = `worktreeMap.has`); apply `query` substring.
6. Sort: default branch → reflog-recent (ordinal asc) → others by `committerdate` desc.
7. Slice `[offset, offset + limit)`; return `nextCursor` if more.

Cursor is opaque; currently `base64(JSON.stringify({ offset }))`. Each call re-runs `for-each-ref` rather than caching a generation — cheap enough that caching isn't worth the invalidation complexity.

## Client flow

- `useBranchContext` = `useInfiniteQuery` keyed by `(projectId, hostUrl, query, filter)`. First page sends `refresh: true`; subsequent pages don't. React Query cancels via `AbortSignal` on rapid typing.
- Types (`BranchRow`, `BranchFilter`) are derived from the server zod schema via `inferRouterInputs` / `inferRouterOutputs` — no duplicate enums.
- Picker uses a 2-tab strip (Branch / Worktree) bound to the server `filter`, an `IntersectionObserver` sentinel for infinite scroll, and server-side search.

## Actions per row

| Tab      | Click on row body (existing behavior) | Hover-reveal action                        |
|----------|----------------------------------------|--------------------------------------------|
| Branch   | Set as base branch → user types prompt → submit → fork new branch | **Check out** — create workspace reusing this branch |
| Worktree | Set as base branch → fork from this worktree's branch | **Open** — navigate to existing workspace |

Why split this way:
- Click stays as "select" to preserve today's prompt-driven fork flow. Changing click to dispatch an action would be a UX regression.
- Action button = immediate commit. Skips the prompt dance when the user's intent is clear.
- Row state is invariant within a tab (Branch tab rows never have a worktree; Worktree tab rows always do), so one button per tab is enough.

"Check out" over "Create" because the distinguishing axis is *branch-level*: Check out reuses an existing branch as-is; click+submit creates a new one. Both create a workspace — that's not the signal the user needs.

### `workspaceCreation.checkout` procedure

Separate from `create`, not a mode flag. `git worktree add <path> <branch>` with no `-b`, no dedup. Auto-resolves `<branch>` vs `origin/<branch>`; fetches latest when only the remote ref exists. Same cloud-workspace registration + setup-script + rollback as `create`. Throws `CONFLICT` if the branch is already checked out elsewhere (client pre-empts this via `isCheckedOut`).

### Edge cases

- **Branch already checked out in main clone.** `isCheckedOut` is true — Check out button renders disabled with tooltip "Already checked out in another worktree". Click-to-set-as-base still works (fork is unaffected).
- **Remote-only row** (`isRemote && !isLocal`). Check out passes `origin/<branch>` to `git worktree add`, which auto-creates a local tracking branch.
- **Worktree'd branch appears in Branch tab search.** Can't happen — filter is server-side and applied before `query`. The row belongs in the Worktree tab.

### Visual

- `default` badge (unchanged).
- `remote` badge when `isRemote && !isLocal` — useful signal that the branch isn't fetched locally.
- No `worktree` badge — implicit from the tab.
- Relative commit date on the right; swaps out for the action button on hover.

## Deferred

- **Prompt carry-over on Open.** Today the typed prompt is dropped. Fix: add a one-shot zustand `pendingWorkspaceSeed` store, consume it in the v2 ChatPane's currently-null `initialLaunchConfig`. Infra exists in the main-screen ChatPane; just not wired on v2.
- **Project-not-cloned case.** `searchBranches` returns empty when the project has no local `projects` row. Needs either auto-`project.setup` on modal open or a GitHub API fallback.
- **Recency section headers** ("Recent" / "Other"). Server already emits in recency order; pure rendering change.
- **Virtualization.** Infinite query keeps all fetched pages in memory. If repos with thousands of *shown* branches become real, add `@tanstack/react-virtual`.

## Things explicitly not in scope

- PR-based branch discovery — `searchPullRequests` + `linkedPR` handle that separately.
- Fuzzy match / ranking — substring is enough for branch names.
- Author / commit-subject fetch — doesn't pay for itself in a picker.
- Cross-project branches — project picker's job.
