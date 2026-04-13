# Pending workspace flow — three intents, one path

Scope: the workspace-creation handoff from the new-workspace modal through `/pending/<id>` to the host-service. Today only **fork** uses this path; **checkout** and **adopt** are fire-and-forget. This unifies them.

## Background

Three buttons, three different actions:

| Intent | Trigger | What happens server-side |
|--------|---------|---------------------------|
| **fork** | Submit (after typing prompt + picking base branch) | New branch created from base. `workspaceCreation.create`. Slow path: clones repo, fetches base, worktree-add, cloud + local register, optional setup script. |
| **checkout** | "Check out" button on Branch tab | Existing branch reused as-is. `workspaceCreation.checkout`. Same slow path minus dedup; auto-resolves local vs. `origin/<branch>`. |
| **adopt** | "Create" button on Worktree tab (orphan) | `.worktrees/<branch>` already on disk; just register the missing workspace rows. `workspaceCreation.adopt`. Fast — DB inserts only. |

The "Open" button on the Worktree tab is *not* in scope here — it's pure navigation, no mutation, no pending state.

## What's wrong today

Fork goes through `pendingWorkspaces` row + `/pending/<id>` page + retry on failure. Checkout and adopt skip it: fire mutation, modal closes, toast on error, no recovery.

That breaks down for checkout in particular — first-time-on-this-project checkout can clone a multi-GB repo, fetch, run setup. The user sees the modal close and has nothing on screen until it finishes (or fails). And if it fails, they re-type everything.

Adopt is fast enough that this doesn't matter for performance, but consistency does — three buttons that look identical shouldn't behave radically differently when something goes wrong.

## Design

### Schema (one row, intent discriminator)

```ts
export const pendingWorkspaceSchema = z.object({
  // Shared
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  hostTarget: z.unknown(),
  intent: z.enum(["fork", "checkout", "adopt"]).default("fork"),
  name: z.string(),
  branchName: z.string(),  // fork: derived from prompt; checkout/adopt: existing branch
  status: z.enum(["creating", "failed", "succeeded"]).default("creating"),
  error: z.string().nullable().default(null),
  workspaceId: z.string().nullable().default(null),
  warnings: z.array(z.string()).default([]),  // surfaced on pending page
  terminals: z.array(...).default([]),
  createdAt: persistedDateSchema,

  // Fork-only (nullable for checkout/adopt)
  prompt: z.string().default(""),
  baseBranch: z.string().nullable().default(null),
  baseBranchSource: z.enum(["local", "remote-tracking"]).nullable().default(null),
  linkedIssues: z.array(z.unknown()).default([]),
  linkedPR: z.unknown().nullable().default(null),
  attachmentCount: z.number().int().default(0),

  // fork + checkout (irrelevant for adopt)
  runSetupScript: z.boolean().default(true),
});
```

v2 isn't released — no migration concerns. We just change the schema.

### Per-intent handlers (modal → pending row + navigate)

`PromptGroup` keeps its three click handlers, but each one now:

1. Generates `pendingId`.
2. Inserts a `pendingWorkspaces` row tagged with `intent`.
3. Closes modal.
4. Navigates to `/pending/<pendingId>`.

The mutation no longer fires from the modal — the pending page does it on first mount. This mirrors how fork already works.

### Pending page (intent dispatch + UI variants)

```ts
useEffect(() => {
  if (pending.status !== "creating") return;
  const fire = async () => {
    try {
      const result = await runIntent(pending);  // switch on pending.intent
      collections.pendingWorkspaces.update(pendingId, (row) => {
        row.status = "succeeded";
        row.workspaceId = result.workspace?.id ?? null;
        row.terminals = result.terminals ?? [];
        row.warnings = result.warnings ?? [];
      });
    } catch (err) {
      collections.pendingWorkspaces.update(pendingId, (row) => {
        row.status = "failed";
        row.error = err instanceof Error ? err.message : String(err);
      });
    }
  };
  void fire();
}, [pending.intent, pending.status, pendingId]);

function runIntent(pending: PendingWorkspaceRow) {
  switch (pending.intent) {
    case "fork":     return createWorkspace({ ... });
    case "checkout": return checkoutWorkspace({ ... });
    case "adopt":    return adoptWorktree({ ... });
  }
}
```

UI per intent:
- **fork** / **checkout**: progress steps from host-service `getProgress` (`ensuring_repo` → `creating_worktree` → `registering`). Existing UI.
- **adopt**: generic spinner. No host-service progress to poll because adopt doesn't `setProgress`.

Render `warnings` on success for all intents (currently only fork shows them) — checkout in particular can warn about a failed setup-terminal launch.

### Failure + retry

Same shape as fork today. The "Retry" button on the pending page calls a `useRetry` hook that switches on intent and re-runs the right mutation with the stored row state.

### Adopt-only consideration

Adopt is fast enough that the pending page may flash and resolve. That's fine — the failure-toast path becomes a real recovery path, which is the actual value here. Don't try to skip the page for adopt; consistency wins.

## What we keep / drop

**Keep:**
- `useCreateDashboardWorkspace`, `useCheckoutDashboardWorkspace`, `useAdoptWorktree` hooks. The pending page calls them; only the *call site* moves from PromptGroup into the pending page.
- `pendingWorkspaceSeed` zustand bits (none today; reverted earlier). Open path stays pure navigation.

**Drop:**
- The fire-and-forget bodies in `handleCheckout` / `handleAdoptWorktree`. They become "insert pending row + navigate" only.

## Edge cases

- **Modal closes mid-mutation today** — already handled by the fire-and-forget pattern (closure survives unmount). After this change, the pending page owns the mutation, which makes that explicit instead of accidental.
- **Workspace name resolution** — `name` stored on the pending row is what the user typed (or the branch name fallback). Retry uses the stored value, not whatever the modal had at retry time.
- **Setup terminal warnings** — checkout's procedure already returns `warnings: string[]` (e.g. "Failed to start setup terminal"). Today they're discarded for checkout. After this, the pending page surfaces them — same UI as fork.

## Implementation order

1. Schema: extend `pendingWorkspaceSchema` (`intent`, `warnings`, fork-only fields nullable).
2. Pending page: `useRetry` switches on intent. Add adopt branch + spinner UI. Display `warnings`.
3. PromptGroup: rewrite `handleCheckout` / `handleAdoptWorktree` to insert pending row + navigate. Drop the fire-and-forget mutation calls from these handlers.
4. Verify: each intent end-to-end (fork unchanged; checkout shows progress + warnings; adopt flickers and lands).

## Out of scope

- Persisting the pending state across app restarts (already handled by the localStorage collection).
- Multi-workspace queueing — one pending row at a time per modal session is fine.
- Open-existing prompt seed (still deferred, separate concern).
