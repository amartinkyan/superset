# V2 Chat — Plan to Full Parity & Completion

## Current State

The v2 chat (`routes/_authenticated/_dashboard/v2-workspace`) is structurally complete — message rendering, polling display, send/stop/restart/approval/plan/question flows all exist. However:

1. **The chat has critical memory leaks** — 60fps polling, full-history re-fetching, no virtualization, and no runtime teardown cause a V8 GC death spiral after ~60min idle (#3049) and multi-GB RSS in long sessions (#2882).
2. **The host-service backend has critical stubs** — slash commands, MCP, and title generation return empty/no-op.
3. **Several v1 lifecycle features are missing** — draft saving, launch configs, session pre-creation.

Source: [RENDERER_MEMORY_LEAK_ANALYSIS.md](apps/desktop/docs/RENDERER_MEMORY_LEAK_ANALYSIS.md)

---

## Phase 1: Memory & Performance (Critical — blocks production use)

These issues cause the renderer to become unresponsive after sustained use. They affect both v1 and v2 but are especially severe in v2 because the transport is HTTP (heavier per-poll overhead than IPC).

### 1.1 Adaptive polling — stop 60fps when idle

**Files:**
- `packages/chat/src/client/hooks/use-chat-display/use-chat-display.ts` (v1 hook)
- `apps/desktop/.../hooks/useWorkspaceChatDisplay/useWorkspaceChatDisplay.ts` (v2 hook)

**Problem:** Both hooks poll `getDisplayState` + `listMessages` every 16ms unconditionally, even when the chat is idle. `refetchIntervalInBackground: true` means this runs even when the pane is hidden. `staleTime: 0` + `gcTime: 0` maximizes GC churn.

**What to do:**
- Poll at 60fps **only while `isRunning` is true** (agent actively streaming)
- Drop to 2–5s when idle (no active run)
- Set `refetchIntervalInBackground: false` so hidden panes don't poll
- Set `gcTime` to a reasonable value (e.g., 30s) to reduce GC pressure
- Consider using the existing event-bus WebSocket to notify the renderer when `isRunning` changes, triggering a single refetch instead of continuous polling

**Impact:** This is the single biggest contributor to #3049. Eliminating idle polling removes the sustained allocation pressure that triggers the V8 GC death spiral.

### 1.2 Fix query invalidation amplifier during active runs

**File:** `apps/desktop/.../hooks/useWorkspaceChatDisplay/useWorkspaceChatDisplay.ts`

**Problem:** A `useEffect` invalidates both chat queries whenever `isRunning` is true, but `queryInput` is recreated on every render (not memoized), so the effect fires more often than intended — amplifying the 60fps polling during active sessions.

```ts
useEffect(() => {
    if (!queryInput) return;
    if (!isRunning) return;
    void Promise.all([
        utils.chat.getDisplayState.invalidate(queryInput),
        utils.chat.listMessages.invalidate(queryInput),
    ]);
}, [isRunning, queryInput, ...]);
```

**What to do:**
- Memoize `queryInput` with `useMemo` so the effect only fires on actual `isRunning` transitions
- Or remove the invalidation entirely — the polling already handles freshness

### 1.3 Paginate or delta-fetch `listMessages`

**Files:**
- `packages/chat/src/server/trpc/service.ts` — `listMessages` returns full transcript
- `packages/host-service/src/runtime/chat/chat.ts` — same pattern

**Problem:** Every poll cycle re-fetches the **entire** conversation history. For long sessions (hours of Codex use, #2882), this payload grows unbounded. At 60fps, a 500-message transcript is serialized/deserialized ~60 times per second.

**What to do:**
- Add a `sinceMessageId` or `offset` parameter to `listMessages`
- On the client, only fetch new messages since the last known message ID
- Fall back to full fetch on session load or when the client detects a gap
- Alternative: cache the message list on the server and return a hash — skip the response body if unchanged

### 1.4 Virtualize the message list

**Files:**
- `apps/desktop/.../WorkspaceChatInterface/components/ChatMessageList/ChatMessageList.tsx` (v2)
- `apps/desktop/src/renderer/components/Chat/ChatInterface/components/MessageList/MessageList.tsx` (v1)

**Problem:** The full conversation is mounted in React at all times. The v2 path also allocates `prefixMessages={renderedMessages.slice(0, messageIndex)}` per user message per render — O(n^2) array allocations.

**What to do:**
- Use a virtualization library (e.g., `@tanstack/react-virtual` or `react-virtuoso`) to only mount visible messages
- Remove the per-message `slice()` — pass the full array + index, or memoize prefix computation
- This directly addresses the renderer-side memory growth in long sessions (#2882)

### 1.5 Tear down chat runtimes on pane close

**Files:**
- `apps/desktop/src/renderer/stores/tabs/store.ts` — `removePane` kills terminals but not chat sessions
- `packages/chat/src/server/trpc/service.ts` — `ChatRuntimeService.runtimes` map has no eviction
- `packages/host-service/src/runtime/chat/chat.ts` — `ChatRuntimeManager` same pattern

**Problem:** Closing a chat pane does not destroy the backing runtime session. The Mastra harness, its thread memory, and all message history remain resident in the main process. Over time, multiple sessions accumulate.

**Prerequisite — the v2 panes API has no chat cleanup hook:** The `PaneDefinition` type (`packages/panes/src/react/types.ts:67`) only exposes `onBeforeClose?(pane): boolean | Promise<boolean>` as a gate, not a post-close cleanup callback. The `chat` pane type in `usePaneRegistry.tsx` defines no `onBeforeClose` at all. Meanwhile, `removePane` in the tabs store (v1) explicitly calls `killTerminalForPane()` for terminals and `cleanupEditorPaneState()` for editors but has **zero chat-specific cleanup**. Without addressing this, the runtime teardown will only work for v1, leaving the v2 path still leaking.

**What to do:**
1. Add a `destroySession` / `releaseSession` procedure to both `ChatRuntimeService` and `ChatRuntimeManager`
2. **v1:** Add a chat cleanup call in `removePane` (tabs store), alongside the existing terminal/editor cleanup
3. **v2:** Either:
   - Add an `onBeforeClose` to the `chat` pane definition in `usePaneRegistry.tsx` that calls the destroy procedure (returning `true` to allow close), or
   - Add a new `onAfterClose` hook to the `PaneDefinition` interface in `@superset/panes` and implement it for chat, or
   - Use a `useEffect` cleanup in `ChatPane.tsx` that calls destroy when the component unmounts (simplest, but depends on React lifecycle guarantees)
4. Add idle eviction: if a runtime hasn't been polled in N minutes (e.g., 10), auto-destroy it server-side as a safety net

### 1.6 Bound the Electric collections cache

**File:** `apps/desktop/src/renderer/routes/_authenticated/providers/CollectionsProvider/collections.ts`

**Problem:** `collectionsCache` is a `Map<string, OrgCollections>` with no eviction. Each entry creates ~20 Electric-backed live subscriptions. If the user switches orgs, old collections accumulate.

**What to do:**
- Evict collections when the user leaves an org (or after a timeout)
- Or cap the cache size (e.g., LRU with max 2–3 entries)

### 1.7 Bound the workspace client cache

**File:** `packages/workspace-client/src/providers/WorkspaceClientProvider/WorkspaceClientProvider.tsx`

**Problem:** `workspaceClientsCache` retains a `QueryClient` + tRPC client per workspace, never evicted.

**What to do:**
- Evict entries when the workspace is unmounted
- Or use a bounded cache with cleanup of the `QueryClient` on eviction

---

## Phase 2: Host-Service Runtime Stubs (Critical — broken features)

The v2 chat UI calls these procedures but they return empty/no-op results.

### 2.1 Plumb an API client into `ChatRuntimeManager`

**Files:**
- `packages/host-service/src/app.ts` (line ~67) — constructs `ChatRuntimeManager` with only `{ db, runtimeResolver }`
- `packages/host-service/src/runtime/chat/chat.ts` (line ~318) — `ChatRuntimeManagerOptions` has no API client

**Problem:** The host-service `ChatRuntimeManager` has no way to call the cloud API. This blocks title generation (`generateAndSetTitle` needs `apiClient.chat.updateTitle.mutate()`), and will block any future feature that writes to the cloud from the runtime. The v1 `ChatRuntimeService` constructs its own tRPC client at initialization.

**What to do:**
- Add an `apiClient` (or a tRPC client factory) to `ChatRuntimeManagerOptions`
- Pass it from `app.ts` during construction
- This is a prerequisite for 2.2 (title generation) and any future cloud-writing features

### 2.2 Add session title generation to host-service

**Files:**
- `packages/host-service/src/runtime/chat/chat.ts` — `sendMessage` does not call `generateAndSetTitle`
- Reference: `packages/chat/src/server/trpc/utils/runtime/runtime.ts` — `generateAndSetTitle`

**Depends on:** 2.1 (API client plumbing)

**What to do:**
- After the first user message (and every Nth), call `generateAndSetTitle` using the Mastra agent or Vercel AI SDK
- Post the title to the cloud API via `apiClient.chat.updateTitle.mutate()`
- Without this, all sessions in the SessionSelector show "New Chat" forever

### 2.3 Port missing v1 runtime lifecycle hooks to host-service

**Files:**
- `packages/host-service/src/runtime/chat/chat.ts` — missing several runtime features present in v1
- `packages/chat/src/server/trpc/service.ts` — v1 reference implementation

**Problem:** The host-service runtime is missing five features that v1 has, making the v2 chat behave differently even once the explicit stubs are filled:

| Feature | v1 location | Host-service status |
|---|---|---|
| `extraTools` (Superset MCP tools) | `service.ts:113` — `getSupersetMcpTools()` injected into `createMastraCode` | Missing — `createMastraCode` called without `extraTools` |
| `reloadHookConfig` on runtime reuse | `service.ts:101` — called when returning cached runtime | Missing — cached runtime returned as-is |
| `runSessionStartHook` | `service.ts:147` — called after runtime creation | Missing — no hook call in `createRuntime` |
| `onUserPromptSubmit` gate | `service.ts:268,300` — called before sending each message | Missing — `sendMessage` goes straight to harness |
| Observer model resolution | `service.ts:118-129` — `resolveOmModelFromAuth()` | Missing |

**What to do:**
- Port `reloadHookConfig`, `runSessionStartHook`, and `onUserPromptSubmit` from the chat package utils into `ChatRuntimeManager`
- Wire `getSupersetMcpTools()` (or equivalent) to inject platform tools via `extraTools`
- Add observer model resolution if applicable to the host-service auth context

### 2.4 Implement `getSlashCommands` in host-service

**Files:**
- `packages/host-service/src/runtime/chat/chat.ts` — currently returns `[]` (line ~573)
- Reference: `packages/chat/src/server/desktop/slash-commands/` — full implementation

**What to do:**
- Port the slash command registry from `packages/chat/src/server/desktop/slash-commands/` into the host-service runtime
- The registry should discover commands from the workspace `cwd` using the canonical `.agents/commands/` path (per AGENTS.md rule 3). The existing registry in `packages/chat` already scans both `.agents/commands/` and `.claude/commands/` (the latter is a symlink) — reuse that logic directly rather than reimplementing with only one path
- Return the command list with names, aliases, descriptions, and parameter schemas

### 2.5 Implement `resolveSlashCommand` and `previewSlashCommand`

**Files:**
- `packages/host-service/src/runtime/chat/chat.ts` — `resolveSlashCommand` always returns `{ handled: false }` (line ~582), `previewSlashCommand` delegates to the same stub (line ~594)
- Reference: `packages/chat/src/server/desktop/slash-commands/resolver.ts`

**What to do:**
- Port the resolver logic (argument substitution, prompt template expansion, action dispatch)
- Wire `previewSlashCommand` to render resolved prompt previews
- Update the v2 `useSlashCommandExecutor` to call `resolveSlashCommand` on the host-service for custom/project-level commands instead of the local `switch` statement fallthrough

### 2.4 Implement `getMcpOverview` and enable MCP

**Files:**
- `packages/host-service/src/runtime/chat/chat.ts` — returns `{ sourcePath: null, servers: [] }` (line ~601)
- `packages/host-service/src/runtime/chat/chat.ts` — `disableMcp: true` hardcoded (line ~373)

**What to do:**
- Remove the `disableMcp: true` hardcode (or make it configurable)
- Implement `getMcpOverview` to return connected MCP server status from the Mastra harness
- This unblocks the `McpControls` overlay in the chat pane

### 2.5 Add `authenticateMcpServer` procedure to host-service chat router

**Files:**
- `packages/host-service/src/trpc/router/chat/chat.ts` — procedure does not exist
- `apps/desktop/src/renderer/routes/.../ChatPaneInterface.tsx` — `useMcpUi` called without `authenticateServer`

**What to do:**
- Add `authenticateMcpServer` mutation to the host-service `chatRouter`
- Wire it through `ChatRuntimeManager` to the Mastra harness's MCP auth flow
- Pass the mutation to `useMcpUi({ authenticateServer })` in v2 `ChatPaneInterface`

---

## Phase 3: Session Lifecycle Reliability

### 3.1 Add background session pre-creation (with abandoned-session policy)

**File:** `apps/desktop/.../hooks/useWorkspaceChatController/useWorkspaceChatController.ts`

**Problem:** Currently, the session DB record is only created on first send, adding latency and creating a race with `organizationId` availability.

**Complication:** Eagerly creating session records will cause empty sessions to appear in the `SessionSelector` as "New Chat" entries, because neither the live query (line ~81) nor the selector component filters out sessions with zero messages. Over time this creates session-list spam.

**What to do:**
- Pre-create the session record in the background when a Chat pane opens with `sessionId === null`
- Add an abandoned-session cleanup policy — choose one:
  - **Option A (client-side filter):** Filter out sessions with no messages and no title from the `SessionSelector` display. This is the simplest but requires knowing message count.
  - **Option B (deferred creation):** Don't create the DB record on pane open — instead, pre-allocate a UUID and prepare the session metadata locally, but only call `createSessionRecord` when the user starts typing or focuses the input. This preserves the latency benefit while avoiding phantom sessions.
  - **Option C (TTL cleanup):** Create eagerly but add a background job (or `useEffect` interval) that deletes sessions older than N minutes that have zero messages and no title. This is the most robust but requires a new API endpoint or periodic client-side cleanup.

### 3.2 Add session init retry logic

**File:** `useWorkspaceChatController.ts`
**Reference:** `apps/desktop/.../hooks/useChatPaneController/session-init-runner.ts`

**What to do:**
- Wrap `createSessionRecord` in a retry runner (max 3 retries, 1500ms delay)
- Add `isSessionInitializing` state for a loading indicator
- Toast on repeated failure

### 3.3 Deduplicate concurrent `getOrCreateSession` calls

**File:** `useWorkspaceChatController.ts`

**What to do:**
- Track the in-flight promise in a ref
- Return existing promise on concurrent calls instead of generating a new UUID
- Prevents orphaned sessions from rapid double-submits

### 3.4 Expose host-service status to the renderer (prerequisite for 3.5 and 3.6)

**Files:**
- `apps/desktop/src/main/lib/host-service-coordinator.ts` (line ~27) — status enum is `"starting" | "running" | "stopped"` — no `"error"` or `"restarting"` value
- `apps/desktop/src/renderer/routes/_authenticated/providers/LocalHostServiceProvider/LocalHostServiceProvider.tsx` (line ~16) — only exposes `{ machineId: string | null; activeHostUrl: string | null }`

**Problem:** The renderer has no visibility into the host-service lifecycle. `LocalHostServiceProvider` only exposes a binary signal (`activeHostUrl` is null or not). The coordinator's status enum exists in the main process but is never surfaced to the renderer. Without this, neither the cold-start fix (3.5) nor auto-restart UI feedback (3.6) can be implemented.

**What to do:**
- Extend the status enum to include `"error"` and `"restarting"` states
- Expose the current status through an IPC channel or tRPC query from the main process
- Add `status: HostServiceStatus` to the `LocalHostServiceContextValue` interface
- Optionally include `lastError: string | null` for diagnostic display

### 3.5 Fix layout.tsx cold-start race condition

**File:** `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/layout.tsx`

**Depends on:** 3.4 (status plumbing)

**What to do:**
- When `activeHostUrl` is `null` and status is `"starting"`, show a loading/spinner state instead of the hard error
- Only show "Workspace host service not available" when status is `"stopped"` or `"error"`

### 3.6 Add host-service auto-restart on crash

**File:** `apps/desktop/src/main/lib/host-service-coordinator.ts`

**Depends on:** 3.4 (status plumbing for `"restarting"` state)

**What to do:**
- Auto-restart with exponential backoff (1s, 2s, 4s, cap 30s) on unexpected exit
- Cap at 5 attempts before surfacing a persistent error
- Emit `"restarting"` status so the UI can show "Reconnecting..."

---

## Phase 4: Feature Parity with V1

### 4.1 Implement `DraftSaver` for v2 chat panes

**What to do:**
- Persist textarea content to pane data in `@superset/panes` store on unmount
- Restore on re-mount (tab switching), clear after send

### 4.2 Wire up `initialLaunchConfig` support

**File:** `apps/desktop/.../ChatPane/ChatPane.tsx` — `initialLaunchConfig={null}` hardcoded (line 44)

**What to do:**
- Accept `initialLaunchConfig` from pane data or workspace-level launch intent
- Wire through to `ChatPaneInterface` so auto-launch fires
- Add `consumeLaunchConfig` callback to prevent re-send on re-mount

### 4.3 Fix `isFocused` to reflect actual pane focus

**File:** `apps/desktop/.../ChatPane/ChatPane.tsx` — hardcoded to `true` (line 46)

**What to do:**
- Read from `@superset/panes` store (active tab + pane)
- Prevents keyboard shortcuts (Ctrl+F) from firing in unfocused panes

### 4.4 Add `abort` procedure to host-service

**What to do:**
- Add alongside `stop`, or unify if semantically identical in Mastra
- Wire v2 `useWorkspaceChatDisplay`'s `abort: async () => undefined` to the real procedure

### 4.5 Fix `SlashCommandPreview` to work without a session

**What to do:**
- Currently disabled when `sessionId` is `null` (line 75)
- Change to use `workspaceId` alone (like v1 uses `cwd`)

---

## Phase 5: Robustness & Polish

### 5.1 User-friendly error states for remote workspace failures

**What to do:**
- Relay `503 Host not connected` → "Host machine is offline" with retry button
- Host-service crash → "Connection lost — reconnecting..." with auto-retry
- Surface host-service status in workspace UI

### 5.2 Ensure pane layout persistence on first visit

**File:** `apps/desktop/.../hooks/useV2WorkspacePaneLayout.ts`

**What to do:**
- Store subscription silently drops changes if `v2WorkspaceLocalState` record doesn't exist yet
- Ensure the record exists before subscription starts, or queue pending writes

### 5.3 Add workspace `ensure` call to v2 controller

**What to do:**
- v1 calls `apiTrpcClient.workspace.ensure.mutate(...)` to sync workspace to cloud
- Add to v2 during session creation

---

## Phase 6: Rich Text Composer (TipTap Migration)

### 6.1 Replace PromptInput textarea with TipTap editor

**Files:**
- `packages/ui/src/components/ai-elements/prompt-input.tsx` — current `PromptInputTextarea` uses a plain `<textarea>`
- Reference: Claude Code's web composer uses TipTap/ProseMirror with `contenteditable` and inline `node-mention` React renderers

**Problem:** The plain `<textarea>` cannot render inline components. File mentions (`@path`) are inserted as raw text, with no visual distinction from regular input until the message is sent. A TipTap-based editor would allow inline mention chips, slash command nodes, and future rich input features.

**What to do:**
1. Add `@tiptap/react`, `@tiptap/starter-kit`, and `@tiptap/extension-mention` to `packages/ui`
2. Create a new `PromptInputEditor` component (TipTap-based) alongside the existing `PromptInputTextarea`
3. Implement a custom `Mention` node extension that renders file mentions as inline button chips (file icon + path, styled like the existing `FileMentionChip`)
4. Wire the `@` trigger to open the `MentionPopover` and insert a structured mention node on selection (instead of plain text)
5. Handle serialization: on submit, convert the TipTap document to `{ text: string, mentions: string[] }` — the text field contains `@path` tokens for backward compatibility with `parseUserMentions` in sent messages
6. Preserve all existing keyboard behavior: Enter to submit, Shift+Enter for newline, Cmd+A, undo/redo
7. Preserve file drop/paste attachment integration
8. Update `PromptInputProvider` context to expose the TipTap editor instance instead of `{ value, setInput, clear, focus }`
9. Migrate v2 `ChatInputFooter` to use the new editor, keeping v1 on the textarea until v1 is deprecated

**Scope considerations:**
- This is a standalone input component refactor, not a chat feature — no chat plan items depend on it
- Can be done incrementally: start with v2 only, keep v1 on the textarea
- The mention popover search (already wired to `workspaceTrpc.filesystem.searchFiles`) stays the same — only the insertion target changes

---

## Phase 7: Code Health

### 7.1 Deduplicate v1/v2 ChatMessageList sub-components

**What to do:**
- Both v1 and v2 maintain full independent copies of: `AssistantMessage`, `UserMessage`, `ToolCallBlock`, `ReasoningBlock`, `StreamingMessageText`, `ThinkingMessage`, `ToolPreviewMessage`, `SubagentExecutionMessage`, `PendingApprovalMessage`, `PendingPlanApprovalMessage`, `PendingQuestionMessage`, `InterruptedFooter`, `ChatSearch`, `MessageScrollbackRail`
- Extract to `packages/chat/client` or `renderer/components/Chat/` and import from both
- Prevents drift between versions

### 7.2 Wire up "Save All" in unsaved-changes dialog

**Files:**
- `apps/desktop/.../page.tsx` (line 259, TODO)
- `apps/desktop/.../hooks/usePaneRegistry/usePaneRegistry.tsx` (line 83)

---

## Priority Matrix

| Priority | Item | Issue | Impact |
|----------|------|-------|--------|
| **P0** | 1.1 Adaptive polling | #3049 | **Root cause of GC death spiral** — renderer unusable after ~60min |
| **P0** | 1.2 Fix invalidation amplifier | #3049 | Compounds polling pressure during active runs |
| **P0** | 1.5 Runtime teardown on pane close | #2882 | Main-process memory grows without bound (requires v2 pane cleanup hook) |
| **P0** | 2.1 API client plumbing | — | Prerequisite for title generation and any cloud-writing feature |
| **P0** | 2.2 Title generation | — | Sessions unlabeled — unusable UX |
| **P1** | 1.3 Paginate `listMessages` | #2882 | Full transcript re-serialized every poll cycle |
| **P1** | 1.4 Virtualize message list | #2882 | Long sessions mount hundreds of React components + O(n^2) slicing |
| **P1** | 2.3 Runtime lifecycle parity | — | Missing hooks/tools/gates make v2 behave differently from v1 |
| **P1** | 2.4–2.5 Slash commands | — | Custom project commands silently fail |
| **P1** | 3.4 Host-service status plumbing | — | Prerequisite for cold-start fix and auto-restart UI |
| **P1** | 3.5–3.6 Cold-start race + auto-restart | — | First visit shows hard error; single crash = permanent broken state |
| **P2** | 1.6–1.7 Bound caches | #3049 | Secondary memory growth path |
| **P2** | 2.6–2.7 MCP support | — | MCP servers completely disabled |
| **P2** | 3.1–3.3 Session lifecycle | — | First-message latency + orphaned sessions (needs abandoned-session policy) |
| **P3** | 4.1–4.5 V1 parity | — | Draft saving, launch config, focus, abort |
| **P3** | 5.1–5.3 Polish | — | Error states, persistence edge cases |
| **P3** | 6.1 TipTap composer | — | Inline mention chips, rich input UX |
| **P4** | 7.1–7.2 Code health | — | Maintenance, not user-facing |

## Suggested Execution Order

**Sprint 1 — Stop the bleeding (memory):**
1.1 → 1.2 → 1.5 (adaptive polling + invalidation fix + runtime teardown incl. v2 pane cleanup hook)

**Sprint 2 — Usable v2 chat:**
2.1 → 2.2 → 2.3 (API client plumbing → title gen → runtime lifecycle parity)
2.4 → 2.5 (slash commands)
3.4 → 3.5 → 3.6 (status plumbing → cold-start fix → auto-restart)

**Sprint 3 — Scalable chat:**
1.3 → 1.4 (message pagination + virtualization)

**Sprint 4 — Full feature set:**
2.6 → 2.7 (MCP)
3.1 → 3.3 (session lifecycle with abandoned-session policy)
4.1 → 4.5 (v1 parity)

**Sprint 5 — Polish:**
1.6 → 1.7 (cache bounds)
5.1 → 5.3 (error states)
7.1 → 7.2 (code health)

**Sprint 6 — Rich composer:**
6.1 (TipTap migration for PromptInput — standalone workstream)
