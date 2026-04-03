# HostService Next Migration Step

This doc is the handoff after the current host-service durability branch.

It answers two questions:

- what the current branch actually achieved
- what the next migration step is

## Current Branch Achieved

The current branch moves `HostService` from "plain child process" toward
"supervised background service inside the app lifetime".

What is true after this work:

- `ElectronMain` supervises `HostService`
- `HostService` has explicit status:
  - starting
  - running
  - degraded
  - restarting
  - stopped
- `HostService` exposes basic version/protocol metadata
- tray can show host-service status
- app update flow can mark a running host-service as restart-needed
- `HostService` can survive window, renderer, route, tab, and workspace churn

That is useful progress.

## What It Is Not Yet

It is not yet a durable service boundary independent of the app process.

Today:

- `ElectronMain` still stops host-service on quit
- host-service still exits when its parent dies
- startup still depends on parent-child IPC for port discovery
- there is no stable service manifest or adoption of an already-running service

So the current branch gives:

- in-app durability

It does not yet give:

- out-of-app durability
- independent service discovery
- a reusable service boundary across app restarts

## Next Migration Step

The next step is:

- make `HostService` discoverable and adoptable as a service boundary

This is the step that turns it from:

- supervised child

into:

- durable local service that `ElectronMain` can find, validate, and attach to

## Implementation

### 1. Add A Service Manifest

Persist a small manifest for the running host-service instance.

Suggested fields:

- `pid`
- `endpoint`
- `authToken`
- `serviceVersion`
- `protocolVersion`
- `startedAt`
- `organizationId`

This should be stored in a stable local path under the app data directory.

### 2. Discover Before Spawn

On app startup:

- read the manifest
- check whether the process is still alive
- try to connect to the recorded endpoint
- validate auth/version/protocol
- only spawn a new host-service if discovery fails

This replaces "always spawn child and wait for ready IPC" as the primary path.

### 3. Separate UI Quit From Service Shutdown

Decide explicit behavior for:

- close last window
- quit app UI
- quit everything

If the service is meant to remain alive beyond the UI shell, then:

- do not always call `stopAll()` on quit
- do not always kill host-service on parent death

If we are not ready for that yet, keep the current behavior but treat it as an
explicit intermediate state.

### 4. Make Restart Intentional

Use the new version/protocol surface as a real restart gate.

Rules:

- protocol mismatch => restart required
- version mismatch with protocol compatibility => restart available
- active long-lived services => prompt or defer restart

### 5. Fix Cross-Platform Background UX

Do not keep the app alive in the background on platforms where the user has no
way to reopen or control it.

That means one of:

- add tray/background support on those platforms
- or do not keep the app alive after the last window closes there yet

## File Targets

Primary:

- `apps/desktop/src/main/lib/host-service-manager.ts`
- `apps/desktop/src/main/host-service/index.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/lib/tray/index.ts`
- `packages/host-service/src/trpc/router/health/health.ts`

Likely additions:

- a local service-manifest helper under `apps/desktop/src/main/lib/`
- a host-service discovery helper used by `HostServiceManager`

## Acceptance

This next step is done when:

- app startup attempts to discover an existing host-service before spawning
- host-service compatibility is validated through a real handshake
- background behavior is coherent on every platform we support
- restart requirements are explicit and user-visible
- the app can clearly distinguish:
  - closing UI
  - stopping host-service
  - quitting everything
