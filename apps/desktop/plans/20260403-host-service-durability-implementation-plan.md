# HostService Durability Implementation Plan

This plan makes `HostService` the durable owner of long-lived local services.

Scope for this plan:

- durable across renderer, route, tab, workspace, and window churn
- `ElectronMain` remains the supervisor
- tray/background behavior is part of the implementation
- service restart/update behavior is part of the implementation

Out of scope for the first cut:

- host-service surviving full explicit app quit
- detached system daemon behavior
- cold restore for individual services

## Current State

Today:

- `ElectronMain` spawns `HostService` as a child process and waits for a random
  port over IPC
  - `apps/desktop/src/main/lib/host-service-manager.ts`
- `HostService` exits when the parent dies
  - `apps/desktop/src/main/host-service/index.ts`
- app quit stops all host-service instances
  - `apps/desktop/src/main/index.ts`
- tray currently reflects the old terminal daemon, not `HostService`
  - `apps/desktop/src/main/lib/tray/index.ts`
- app update flow only knows about the desktop app binary
  - `apps/desktop/src/main/lib/auto-updater.ts`

So the current model is:

- host-service is process-separated
- but it is still parent-owned, not durable in app behavior
- tray and update UX are not yet host-service-aware

## Target State

After this plan:

- `ElectronMain` supervises `HostService`
- `HostService` stays alive while the app is backgrounded
- closing the last window does not stop `HostService`
- tray reflects `HostService` status
- `ElectronMain` can detect host-service version/protocol mismatch
- `ElectronMain` can restart `HostService` safely
- long-lived local services inherit `HostService` lifetime by default

## Business Rules

### Tray

- show tray when background mode is enabled or `HostService` is running
- closing the last window hides the UI and keeps the app alive if
  `HostService` is running
- tray shows coarse host-service status:
  - starting
  - running
  - degraded
  - restarting
  - update required
- tray actions:
  - Open Superset
  - Restart Host Service
  - Stop Host Service
  - Check for Updates
  - Quit

### Quit

- `Quit` from the app menu or tray should mean:
  - stop `HostService`
  - dispose tray
  - exit app
- closing windows should not mean quit if `HostService` is running

### Updates

- app update checks continue in the background
- `ElectronMain` must also version-check the running `HostService`
- use two levels of compatibility:
  - `serviceVersion`: human-facing build version
  - `protocolVersion`: hard compatibility gate
- policy:
  - if protocol matches and service is older, allow current service and show
    restart/update available
  - if protocol mismatches, require host-service restart before new work starts
- restart timing:
  - if no active long-lived services are running, allow immediate restart
  - if active services exist, let the user choose:
    - Restart now
    - Restart when idle
    - Later

## Phase 1. HostService Supervision

Goal:

- make `HostService` a first-class supervised process in `ElectronMain`

Implementation:

- extend `HostServiceManager` status model beyond
  `starting | running | crashed`
  - add at least:
    - `starting`
    - `running`
    - `degraded`
    - `restarting`
    - `stopped`
- add explicit methods:
  - `start(organizationId)`
  - `stop(organizationId)`
  - `restart(organizationId)`
  - `getStatus(organizationId)`
  - `getServiceInfo(organizationId)`

File targets:

- `apps/desktop/src/main/lib/host-service-manager.ts`
- `apps/desktop/src/main/index.ts`

Acceptance:

- `ElectronMain` can start, stop, restart, and observe host-service cleanly
- process supervision is no longer just "spawn and hope"

## Phase 2. Service Discovery And Identity

Goal:

- make a running `HostService` discoverable and verifiable

Implementation:

- add a small host-service info contract returned by health/status APIs:
  - `serviceVersion`
  - `protocolVersion`
  - `startedAt`
  - `uptime`
  - `organizationId`
  - optional subsystem summaries
- extend existing health router instead of creating a second status surface

File targets:

- `packages/host-service/src/trpc/router/health/health.ts`
- `packages/host-service/src/app.ts`
- `apps/desktop/src/main/lib/host-service-manager.ts`

Acceptance:

- `ElectronMain` can verify that the running host-service is compatible
- status checks no longer rely only on "did the port open"

## Phase 3. Tray And Background Lifecycle

Goal:

- make tray reflect `HostService`, not the old terminal daemon

Implementation:

- rewrite tray polling/menu building to read host-service status
- remove daemon-specific session logic from tray
- on macOS:
  - keep tray alive while host-service is running
- on last-window-close:
  - hide windows
  - do not stop host-service
  - do not dispose tray
- on explicit quit:
  - stop host-service
  - dispose tray
  - exit app

File targets:

- `apps/desktop/src/main/lib/tray/index.ts`
- `apps/desktop/src/main/index.ts`

Acceptance:

- tray remains useful even with no windows open
- host-service lifetime is no longer coupled to window lifetime

## Phase 4. Update And Restart Policy

Goal:

- support updating the app while also handling host-service restarts safely

Implementation:

- keep binary update checks in:
  - `apps/desktop/src/main/lib/auto-updater.ts`
- add host-service compatibility checks on:
  - app startup
  - host-service connect
  - after app update install
- add restart policy:
  - immediate restart if idle
  - prompt if active services exist
- add a pending-restart state exposed to tray and renderer

File targets:

- `apps/desktop/src/main/lib/auto-updater.ts`
- `apps/desktop/src/main/lib/host-service-manager.ts`
- `apps/desktop/src/main/lib/tray/index.ts`
- `packages/host-service/src/trpc/router/health/health.ts`

Acceptance:

- app update and host-service restart are no longer separate invisible systems
- protocol mismatch results in a clear restart requirement

## Phase 5. Move Long-Lived Services Behind HostService

Goal:

- treat `HostService` as the default owner of long-lived local services

Implementation:

- require each service to expose explicit control operations:
  - create
  - attach
  - detach
  - dispose
- keep streaming transport separate from control semantics
- do not require an already-open websocket to dispose or restart service state

Primary file targets:

- `packages/host-service/src/app.ts`
- `packages/host-service/src/trpc/router/*`
- `packages/host-service/src/runtime/*`
- service-specific routes like
  - `packages/host-service/src/terminal/terminal.ts`

Acceptance:

- `HostService` is the runtime owner
- renderer is only a client

## Phase 6. Warm Reattach

Goal:

- reconnect to a live `HostService` cleanly before adding cold restore

Implementation:

- define per-service reattach semantics
- ensure reconnect works after:
  - tab/workspace churn
  - renderer restart
  - host-service restart after reconnect path is re-established

Acceptance:

- long-lived services survive UI churn without needing restore-from-disk

## Future Phase. Detached HostService

Only do this if we want services to survive full explicit app quit or crash.

That would require:

- detached spawn or external service registration
- stable manifest/discovery outside parent IPC
- explicit shutdown controls
- update choreography for a service that may outlive the app

Not required for this first durability cut.

## Recommended Order

Implement in this order:

1. supervision
2. health/version contract
3. tray/background lifecycle
4. update/restart policy
5. move services fully behind host-service
6. warm reattach
7. detached host-service only if later needed

## Definition Of Done

This plan is complete when:

- closing the last window does not stop `HostService`
- tray reflects host-service status
- explicit quit stops host-service
- `ElectronMain` can detect host-service compatibility
- host-service can be restarted intentionally
- long-lived services are understood to live behind host-service by default
