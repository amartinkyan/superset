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

---

# Branch picker actions — design

Once branches are listed, each row needs to lead somewhere. This extends the picker from "select a base branch" to offering one base-branch-selection plus one immediate action per row.

## Actions per row

Preserve today's click behavior; add exactly one action button per row, tab-specific:

| Tab      | Click on row body             | Action button                            |
|----------|-------------------------------|------------------------------------------|
| Branch   | Set as base branch (→ user types prompt → submits → Fork) | **Checkout** — create workspace reusing this branch |
| Worktree | Set as base branch (→ Fork from this worktree's branch) | **Open** — navigate to existing workspace |

Why this split:

- **Click = select** keeps the current mental model. The user's primary flow is still "type a prompt, pick a base, submit" — click shouldn't yank them out of that.
- **Action button = commit**. When the user's intent is to open an existing workspace or pick up an existing branch as-is, they want to skip the prompt dance. One button, one click.
- The action button's meaning collapses per tab because the row state is invariant within a tab (Branch tab rows never have a worktree; Worktree tab rows always do). No need to render both Open and Checkout on the same row.

## UX — per-row

Default state:

```
⎇ feature-foo  [remote]             3d ago   [✓ when selected]
```

On hover (or keyboard focus):

```
⎇ feature-foo  [remote]             3d ago   [Check out]     <-- Branch tab
⎇ feature-bar                       1h ago   [Open]          <-- Worktree tab
```

- Clicking row body = set as base branch (existing behavior, closes popover).
- Action button appears on hover/focus; clicking it dispatches immediate action and closes the modal.
- Keyboard: arrows to move; **Enter** = set as base branch; **⌘+Enter** = action button.

Disable the action button (don't just hide — show greyed with tooltip) when the action isn't valid; see §Edge cases.

## State shape

`draft.baseBranch: string | null` stays as-is for the click path — it already works.

For the Checkout action path, the picker dispatches a direct call into a new handler that runs the host-service `checkout` mutation and navigates, without going through the draft or the modal's submit path. No draft shape change needed.

For the Open action, the picker navigates immediately — no draft, no mutation. See §Opening existing.

## Host-service API

Add one procedure; don't overload `create`:

```ts
checkout: protectedProcedure
  .input(z.object({
    pendingId: z.string(),
    projectId: z.string(),
    workspaceName: z.string(),
    branch: z.string(),              // existing branch name, reused as-is
    linkedContext: /* same as create */,
    composer: /* same as create */,
  }))
  .mutation(async ({ ctx, input }) => {
    // git worktree add <path> <branch>
    //   — no -b, no --no-track; branch already exists.
    // Same cloud-workspace registration + setup-script path as create.
  });
```

Rationale for a separate procedure over a `mode: "fork" | "checkout"` flag on `create`: the contracts diverge (no `branchName` input, no dedup logic, different git command), error cases differ (checkout can fail if branch is already checked out elsewhere). One flag would either balloon the input schema or carry invalid combinations.

`create`'s `deduplicateBranchName` stays as-is for fork; checkout skips it entirely.

## Opening existing

Worktree tab's action button. Doesn't touch the draft:

1. Look up the workspace row for this branch via the `workspaces` collection on the client.
2. Seed the typed prompt (see below), then `navigate({ to: "/v2-workspace/$workspaceId", params: { workspaceId } })`.
3. Close the modal.

### Prompt carry-over on Open

If the user typed a prompt before hitting Open, drop it on the floor would be lossy. Carrying it into the existing workspace's chat is the right call. Two implementation paths exist; both are achievable.

**Path A — Launch config plumbing (cleanest, more code).**

The main-screen ChatPane already threads `initialLaunchConfig` with an `initialPrompt` field (`screens/main/.../ChatPane.tsx:217` → `ChatPaneInterface.tsx:639`). The v2 ChatPane's `initialLaunchConfig` is currently hardcoded to `null` (`v2-workspace/$workspaceId/.../ChatPane.tsx:44`). The infra exists; the wire just isn't connected.

Steps:
- Extend the v2 ChatPane to accept a launch config from an ambient source.
- Introduce a one-shot zustand store: `usePendingWorkspaceSeed({ workspaceId, prompt, attachments })`.
- Branch picker's Open handler: set pending seed → navigate → close modal.
- v2 ChatPane on mount: read pending seed for its workspaceId, clear it, pass into `initialLaunchConfig`.

This reuses all existing launch-config behavior (retry, metadata, dedup via `getLaunchConfigKey`). Also unblocks other "open existing workspace with a prompt" entry points later (e.g., notifications, CLI, deep links).

**Path B — Route search param (fast, dirty).**

Navigate to `/v2-workspace/$workspaceId?prompt=<encoded>`. Chat pane reads the param on mount, clears it via `navigate({ replace: true, search: { prompt: undefined } })`, and seeds. Works if the prompt is short; breaks down with attachments, long prompts, or shareable URLs (someone sharing a URL with a pasted prompt accidentally is awkward).

**Recommendation:** Path A. It's more work but aligns with how the app already seeds prompts and handles the attachment case for free. If we're tight on time, Path B unblocks the UX and we migrate to A when the "open existing with prompt" pattern appears elsewhere.

### What the button label says

- Prompt empty: "Open"
- Prompt non-empty: "Open & send" (hint that the prompt will go with them)

## Edge cases

- **Branch tab row where a workspace has actually been created on this branch since last refresh.** The filter excluded it server-side, so the user won't see it. If the user types the name explicitly in the search box, it still won't match — because the filter is applied before the query. This is correct behavior, not a bug: the row belongs in the Worktree tab.
- **Checkout against a branch that's already checked out in the main clone.** `git worktree add <path> <branch>` fails if the branch is currently checked out anywhere else. To avoid offering a broken button: the server returns `isCheckedOut: boolean` per row (true if this branch is checked out in any git worktree — primary or additional). Client disables the Checkout button when true, with tooltip "Checked out in main clone". Click-to-select-as-base-branch still works; the user can still fork from this branch.
  - Implementation: extend `listWorktreeBranches` to also return a `checkedOutAll` set (every branch from `git worktree list --porcelain`, including the primary). Emit `isCheckedOut: checkedOutAll.has(name)` on each row.
- **Row's `isRemote: true, isLocal: false`** (a remote branch the user hasn't fetched). Checkout should work — `git worktree add <path> origin/<branch>` auto-creates a local tracking branch. Fork already does the right thing.

## Visual deltas alongside this change

- Drop the `worktree` badge from rows. Worktree-ness is implicit from the tab now.
- Keep (or add) a `remote` badge — `isRemote && !isLocal` means the user hasn't fetched this branch locally. Useful signal in the Branch tab.

## Implementation order

1. Host-service: add `isCheckedOut: boolean` to each row (emit from a full-worktree scan alongside the existing superset-worktree scan).
2. Host-service: `checkout` procedure — pure `git worktree add <path> <branch>` (no `-b`, no `--no-track`). Same cloud-workspace registration + setup-script path as `create`. No branch-name dedup.
3. Renderer visuals: drop `worktree` badge; add `remote` badge (shown when `isRemote && !isLocal`).
4. Renderer: picker row action button per tab — Checkout on Branch tab, Open on Worktree tab. Hover/focus to reveal; disabled state when `isCheckedOut` in the Branch tab.
5. Renderer: Checkout handler — call host-service `checkout`, reuse the pending-row pattern from `useSubmitWorkspace`, navigate to the new workspace.
6. Renderer: Open handler — resolve workspace from the `workspaces` collection, set pending seed (Path A), navigate, close modal.
7. Plumbing: connect `initialLaunchConfig` in the v2 ChatPane to the pending-seed store (see §Prompt carry-over).

Steps 1–3 are independent and unblock 4. Step 7 is the only one that touches files outside the modal — do it last.

## Things worth leaving out of scope

- Grouping by recency headers ("Recent" / "Other"). Nice-to-have but orthogonal; drop into a follow-up.
- A dedicated "New workspace from PR" intent — already handled elsewhere via `linkedPR`.
- Cross-project branch discovery in one picker. Project picker handles that.
