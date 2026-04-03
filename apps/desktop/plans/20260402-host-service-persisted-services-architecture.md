# Persisted Abilities Architecture

This is the proposed v2 direction.

Reference glossary:

- `apps/desktop/docs/PERSISTED_ABILITIES_GLOSSARY.md`

The key idea is not "make terminal persistent". It is:

- Electron `main` is a thin orchestration layer
- durable local capabilities live behind persisted runtimes
- `host-service` is the first persisted runtime
- terminal is the first persisted ability

Other abilities may follow the same pattern:

- terminals
- local agents
- indexing/search
- heavy MCP connectors
- long-running local jobs

## Core Rule

Keep these lifetimes separate:

- view lifetime: React pane mount/unmount
- model lifetime: pane exists in persisted app state
- ability lifetime: the runtime keyed by a stable id
- process lifetime: the service that owns the runtime

Persistence bugs happen when these collapse into one boundary.

## Common Open-Source Pattern

Across Electron apps, the durable pattern is usually:

1. `main` coordinates
- windows, tray, updater, deep links
- single-instance lock
- service discovery and restart

2. a backend owns durable state
- local service
- worker process
- external engine or VM

3. the UI attaches to that backend
- renderer is a client, not the owner

Representative examples:

- Electron process model and `utilityProcess`
  - <https://www.electronjs.org/docs/latest/tutorial/process-model>
  - <https://www.electronjs.org/docs/latest/api/utility-process>
- VS Code: thin main plus specialized background processes like `ptyHost`
  - <https://github.com/microsoft/vscode/blob/main/src/vs/code/electron-main/main.ts>
  - <https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/ptyHostMain.ts>
- Rancher Desktop / Podman Desktop: Electron orchestrates durable external runtimes
  - <https://github.com/rancher-sandbox/rancher-desktop/blob/main/background.ts>
  - <https://github.com/containers/podman-desktop/blob/main/packages/main/src/plugin/provider-registry.ts>
- Wave: Electron starts a local backend and the UI talks to it
  - <https://github.com/wavetermdev/waveterm/blob/main/emain/emain.ts>
  - <https://github.com/wavetermdev/waveterm/blob/main/emain/emain-wavesrv.ts>
  - <https://docs.waveterm.dev/durable-sessions>

## Proposed Superset Shape

### 1. Main Is The Orchestrator

`main` should own:

- app boot
- single-instance lock
- service discovery
- service startup/shutdown
- health and version checks
- status exposure to renderer

`main` should not own:

- PTYs
- terminal buffers
- reconnect state
- other long-lived ability state

### 2. Host-Service Is The First Persisted Runtime

`host-service` should become the durable local owner for persisted abilities.

That means:

- one stable local boundary
- one place for auth/discovery/versioning
- one place for long-lived local state

Terminal is the first concrete ability hosted there.

### 3. Each Ability Gets A Stable Identity

For terminal:

- runtime key: `paneId`
- `workspaceId` is metadata only

The same rule should apply to future abilities: stable runtime identity should not depend on the current route or mounted React tree.

### 4. Renderer Only Attaches And Detaches

For persisted abilities, the renderer should usually do:

- mount => attach
- unmount => detach

Actual destruction should be driven by the real model boundary, not React cleanup.

## Terminal Mapping

Terminal in `host-service` should own:

- session registry by `paneId`
- `createOrAttach`
- `detach`
- `dispose`
- resize and mode state
- snapshots
- history / cold restore

The transport can still be websocket. The important rule is:

- transport identity must be session-scoped
- not workspace-scoped

## Recommended Internal Split

Keep the architecture layered:

- `main`
  - orchestrates persisted runtimes
- `host-service`
  - owns durable local abilities
- optional specialized workers
  - for risky or heavy domains like PTYs

If PTYs need stronger isolation later, add a terminal worker under `host-service` rather than moving ownership back into `main` or the renderer.

## Practical Direction

## Phases

### Phase 1. Durable Host-Service

- make `host-service` a durable local runtime
- decouple it from workspace and renderer lifetime
- add stable discovery instead of parent-only startup IPC
- keep `main` responsible for discovery, health, and restart

### Phase 2. Terminal Ownership

- move terminal lifecycle fully into `host-service`
- keep `paneId` as the terminal runtime key
- make renderer terminal views attach/detach only
- keep removal/dispose driven by persisted model state

### Phase 3. Restore Contract

- add `createOrAttach`
- return snapshot plus terminal metadata on attach
- restore terminal state after renderer restart or reattach

### Phase 4. Cold Restore

- persist terminal history and metadata
- support restore after host-service restart or crash
- keep this as a separate path from warm attach

### Phase 5. Worker Isolation

- if PTYs become risky or noisy, isolate them behind a worker under `host-service`
- keep `host-service` as the durable owner even if PTY execution moves down a level

### Phase 6. Generalize Persisted Abilities

- reuse the same model for other durable local abilities
- each ability gets stable identity, attach/detach semantics, and explicit disposal

## Decision

The target architecture is:

- `main` as thin orchestrator
- `host-service` as persisted runtime platform
- terminal as the first persisted ability
- future durable abilities follow the same pattern

That matches the common open-source shape much better than a renderer-owned lifecycle.
