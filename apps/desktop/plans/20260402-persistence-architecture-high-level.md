# Persistence Architecture

This is the high-level model for durable local state in desktop v2.

## Core Idea

Persistence should not be owned by the renderer.

The renderer is a client. It mounts and unmounts views. It should attach to long-lived runtime state, not own it.

## Roles

### ElectronMain

`ElectronMain` is the thin control plane.

It should own:

- windows
- tray
- menus
- deep links
- app lifecycle
- service discovery
- supervision of background services

It should not own long-lived terminal or job state.

### HostService

`HostService` is the long-lived background service.

It should own durable local subsystems such as:

- terminal sessions
- future local jobs
- future indexing/search state
- other long-running local runtimes

## Lifetimes

These lifetimes must stay separate:

- view lifetime: React mount/unmount
- model lifetime: object exists in persisted app state
- runtime lifetime: live session or job exists in `HostService`
- process lifetime: `HostService` itself is running

Most persistence bugs come from collapsing these into one boundary.

## Lifecycle Model

Views should usually do:

- mount => attach
- unmount => detach

Actual destruction should happen only when the underlying model is really gone.

For terminal, that means:

- `paneId` is the view/layout identity
- `terminalId` is the terminal session identity
- panes should persist a `terminalId` reference
- terminal session records should live in the `HostService` DB
- switching tabs or workspaces should detach, not destroy
- removing a pane should remove the pane reference, not necessarily kill the terminal
- terminal disposal should be a separate session lifecycle decision

## Restore Model

There are two restore paths:

- warm reattach: runtime is still alive, client reconnects
- cold restore: runtime died, service restores from persisted state

Warm reattach should be the default path.

## Transport

The transport can still be websocket.

The important rule is:

- transport identity must be runtime-scoped
- not route-scoped or workspace-scoped

## Direction

The target architecture is:

- `ElectronMain` supervises
- `HostService` owns long-lived runtime state
- renderer views attach and detach
- persistence and restore live behind `HostService`

Terminal is the first concrete subsystem that should follow this model.

## Terminal Mapping

For terminal, the model should be:

- `pane`
  - persisted in workspace state
  - stores `terminalId`
- `terminal session`
  - persisted in `HostService`
  - keyed by `terminalId`
- renderer view
  - attaches to the terminal session on mount
  - detaches on unmount

This lets terminal sessions outlive any individual pane while keeping pane layout state separate from terminal runtime state.
