# V2 Branch Discovery — Design

Scope: the branch picker in the v2 new-workspace modal (DashboardNewWorkspaceModal), which currently calls `workspaceCreation.searchBranches` on the host-service and renders a flat list.

## Current state

**V1** (desktop tRPC, `apps/desktop/src/lib/trpc/routers/projects/projects.ts`):
- `getBranchesLocal` — fast, cache-only, no network. Parses `git for-each-ref refs/heads/ refs/remotes/origin/`. Returns `{ name, lastCommitDate, isLocal, isRemote }`.
- `getBranches` — same but runs `git fetch --prune` first. Swapped in when remote data arrives.
- Renderer invalidates both on modal open (`NewWorkspaceModalContent.tsx:26-31`), so the UI shows stale-local immediately and upgrades.
- Sort: default branch first, then `committerdate` desc. No recency grouping.

**V2** (host-service, `packages/host-service/src/trpc/router/workspace-creation/workspace-creation.ts:162`):
- One call: `searchBranches({ projectId, query?, limit? })`.
- No `git fetch`. Runs `git for-each-ref` + `git branch --list`, filters server-side by substring, returns `{ defaultBranch, branches: [{ name, lastCommitDate, isLocal, hasWorkspace }] }`.
- `hasWorkspace` is a nice v2-only signal (joined against local `workspaces` table).
- `useBranchContext` hook is a single `useQuery` keyed by `(projectId, hostUrl)`.

### Gaps v2 → v1
1. No `git fetch --prune` path — remote branches get stale; deleted remote branches linger.
2. No local-first → remote-upgrade pattern — users wait or see partial data.
3. `isRemote` flag is missing (only `isLocal`). Can't tell "this is a local-only branch" vs "local + remote".
4. No recency signal (reflog), so alphabetical-by-date is the only ordering.
5. `git branch --list` is redundant — `refs/heads/` from `for-each-ref` already answers it.

## Prior art (GitHub Desktop, VSCode)

- **GitHub Desktop** groups into **default → recent → other**, where "recent" comes from parsing `git log -g HEAD` (reflog, ~2500 entries). This is the UX pattern most worth stealing — alphabetical-by-date buries the branch the user was literally just on.
- **VSCode** uses cancellation tokens on every ref query so fast typing doesn't queue work. React Query gives us this for free via `AbortSignal` — we just need to thread it through the tRPC fetcher.
- Both lazily load commit author metadata; we don't need author names in v0, so skip.

## Design

### 1. One procedure, rich per-row metadata

`searchBranches` is the only procedure. Each row carries all the facts the UI needs: locality (`isLocal` / `isRemote`), existing worktree (`worktreePath`), recency (`recency`), commit date.

Rationale: worktrees aren't a separate searchable surface in this UI — they're decorations on branches. The workspaces table per project is tens of rows, so joining it on every query is a local SQLite read, not a real cost. Single procedure means one source of truth, no flicker from two independent queries arriving out of order, one invalidation trigger.

### 2. Paginated `searchBranches`

```ts
input: {
  projectId: string;
  query?: string;           // substring, server-side filter
  cursor?: string;          // opaque; currently encodes an offset
  limit?: number;           // default 50, max 200
  refresh?: boolean;        // default false; when true, run `git fetch --prune` first
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
  recency: number | null;         // reflog ordinal, 0 = most recent
  worktreePath: string | null;    // path of existing workspace worktree, else null
};
```

`worktreePath` rather than just `hasWorkspace: boolean` — richer metadata for the same cost, and lets the UI offer "Open existing workspace" as an action instead of just annotating.

Server implementation:

1. If `refresh`, `git fetch --prune --quiet --no-tags` (errors swallowed for offline).
2. `git for-each-ref --sort=-committerdate --format=... refs/heads/ refs/remotes/origin/` — one call, ~20ms even on 10k refs.
3. `SELECT branch, worktree_path FROM workspaces WHERE project_id = ?` — local SQLite, ~1ms. Build `Map<branch, path>`.
4. Parse reflog once (§5) to annotate `recency`.
5. Collapse local+remote pairs into one row with both flags; attach `worktreePath` from the map.
6. Apply server-side sort (§4).
7. If `query`, filter by case-insensitive substring.
8. Slice `[offset, offset + limit)`; return `nextCursor` if more.

Cursor is opaque; v1 encodes `{offset: number}` base64'd. We don't cache the full list between calls — re-running `for-each-ref` is cheap. If that ever shows up in profiling, memoize the sorted-filtered list per `(projectId, query, generation)` where `generation` bumps on fetch/create.

### 3. Renderer strategy

```ts
const branches = useInfiniteQuery({
  queryKey: ['workspaceCreation', 'searchBranches', projectId, hostUrl, query],
  queryFn: ({ pageParam, signal }) =>
    client.workspaceCreation.searchBranches.query(
      { projectId, query, cursor: pageParam, limit: 50 },
      { signal },
    ),
  getNextPageParam: (last) => last.nextCursor,
});
```

On modal open: call `searchBranches` once with `refresh: true` (no cursor, page 1). This populates the cache AND refreshes remote refs in one round-trip. Subsequent pages and search-as-you-type use `refresh: false`. The flag lives on the cache key, so refresh and non-refresh calls don't collide.

Invalidation: on modal open (with `refresh: true`), and on workspace create/delete (cheap — `refresh: false` is ~30ms).

### 4. Sort order

Server emits in this order (client does **not** resort):

1. `defaultBranch` (if present in list)
2. Branches with `recency != null`, ascending recency (0 first). Cap the reflog window at ~30 recent branches.
3. Everything else by `lastCommitDate` desc.

The UI can optionally render `[1]` and `[2]` under a "Recent" header and `[3]` under "Other", matching GitHub Desktop. Worth doing — it's a real UX win with cheap implementation.

### 5. Reflog parsing

In host-service, add a helper:

```ts
async function getRecentBranchOrder(git, limit = 30): Promise<Map<string, number>> {
  // git log -g --pretty=%gs --grep-reflog='checkout:' -n 500 HEAD
  // parse lines like "checkout: moving from <from> to <to>" — take <to>.
  // Dedupe preserving first-seen order. Return name → ordinal.
}
```

Cost: one extra git call, ~10ms on a typical repo. Run it once per `searchBranches` call before the filter/slice step.

### 6. Things to explicitly *not* do

- No PR-based branch discovery here. PRs live in the existing `searchPullRequests` tool; mixing them into the branch picker conflates "start from a branch" with "start from a PR" and both flows already exist.
- No fuzzy match / ranking. Substring is fine for branch names — they're short and users paste or prefix-type. Revisit only if users ask.
- No author/commit-subject fetch. Adds cost and doesn't pay for itself in a picker.
- Don't resort client-side — the server's paginated order is authoritative, and any client re-sort would break when cross-page ordering changes.

### 7. Virtualization

With thousands of branches now plausible, the rendered list needs windowing once the user scrolls past the first page. `useInfiniteQuery` keeps pages in memory; a virtualized list (`@tanstack/react-virtual`) renders only visible rows. Load next page on scroll near the end.

## Implementation order

1. Host-service `searchBranches`: add `isRemote`, drop the redundant `git branch --list`, add reflog helper emitting `recency`, swap `hasWorkspace: boolean` for `worktreePath: string | null`, add `refresh` flag, add cursor pagination. (`packages/host-service/src/trpc/router/workspace-creation/workspace-creation.ts`)
2. Renderer: switch `useBranchContext` to `useInfiniteQuery`; pass `refresh: true` on first page.
3. Renderer: virtualized list + "Recent" / "Other" grouping; render `worktreePath` as an inline action or annotation.
4. Renderer: invalidate branches on modal open and on workspace create/delete.

## Open questions

- Remote host case: when `hostTarget.kind !== "local"`, `git fetch` runs on the remote machine. That's fine but slower; keep the SWR pattern so users on a laggy remote still see cached branches instantly.
- Should `hasWorkspace` disable the row or just annotate it? Current v2 modal lets users pick a branch that has a workspace already — which then creates a second worktree with a deduped branch name. Probably fine but worth confirming with the user.
