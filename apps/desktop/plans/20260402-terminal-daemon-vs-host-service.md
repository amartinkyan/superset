# Terminal Daemon Vs Host Service

This note is the short version of how the current desktop terminal persistence works and what would actually be required to replace the daemon with host service.

## Core Point

We do not strictly need a thing named "daemon".

We do need a long-lived terminal owner that:

- outlives React pane mount/unmount
- owns PTYs by `paneId`
- supports `createOrAttach`, `detach`, and `dispose`
- can return a snapshot on attach
- can survive the failures we care about

If host service can own that lifecycle, it can replace the daemon.

If host service is only tied to the current renderer or current workspace route, it cannot.

## Current Desktop Daemon Shape

Today the old desktop stack works like this:

- renderer calls terminal tRPC
- tRPC calls `WorkspaceRuntime`
- `WorkspaceRuntime` calls `DaemonTerminalManager`
- `DaemonTerminalManager` talks to `TerminalHostClient`
- `TerminalHostClient` talks to a detached terminal daemon
- the daemon owns `Session` objects keyed by `paneId`
- each session owns a PTY subprocess, a headless emulator, and attached clients

Important files:

- `apps/desktop/src/lib/trpc/routers/terminal/terminal.ts`
- `apps/desktop/src/main/lib/workspace-runtime/local.ts`
- `apps/desktop/src/main/lib/terminal/daemon/daemon-manager.ts`
- `apps/desktop/src/main/lib/terminal-host/client.ts`
- `apps/desktop/src/main/terminal-host/index.ts`
- `apps/desktop/src/main/terminal-host/terminal-host.ts`
- `apps/desktop/src/main/terminal-host/session.ts`

## What The Daemon Actually Gives Us

The current daemon is not just "a PTY in the background".

It provides:

- stable session identity by `paneId`
- attach without recreation
- detach without kill
- snapshot on attach via headless xterm serialization
- mode and cwd tracking
- cold restore from disk history
- backpressure isolation
- PTY isolation in a subprocess
- a global process boundary that survives renderer churn

The most important contract is:

- attach returns terminal state
- unmount does not kill
- explicit kill/dispose kills

## What Is Essential Vs Incidental

Essential:

- global terminal runtime keyed by `paneId`
- `createOrAttach`
- `detach`
- `dispose`
- snapshot/restore
- cold restore
- terminal output/history persistence

Incidental:

- the word "daemon"
- NDJSON specifically
- the exact socket split
- whether the owner lives in a separate package or process

## Can Host Service Replace It

Yes, if host service becomes the terminal owner.

That means host service would need to own:

- the PTY map
- session identity by `paneId`
- attach/detach semantics
- snapshot generation
- resize and mode state
- disk-backed history and cold restore
- disposal only when the pane is actually gone

In that model, the daemon disappears as a separate concept and terminal persistence becomes a host-service responsibility.

## What Host Service Has Today

The current host-service terminal route is in:

- `packages/host-service/src/terminal/terminal.ts`

It already has some of the right direction:

- session map keyed by `paneId`
- websocket attach by `/terminal/pane/:paneId`
- detach on socket close
- explicit `dispose`

But it is still much thinner than the daemon stack. It does not currently provide:

- `createOrAttach`
- snapshots on attach
- headless emulator state
- mode rehydration
- cold restore from disk
- history persistence
- subprocess isolation for PTY backpressure
- control/data channel split

So host service is not yet a drop-in replacement for the daemon.

## The Real Decision

The real question is not "daemon or not".

The real question is which process owns durable terminal state.

There are 3 options:

1. Renderer-owned terminal
- Not acceptable for v2 persistence.

2. App-owned background terminal host
- Good enough for tab switch, workspace switch, and renderer restart.
- Not enough if we need sessions to survive full app restart or quit.

3. Separate long-lived background process
- Closest to the current daemon model.
- Needed if we want true persistence across app restarts/crashes.

## Practical Recommendation

If the goal is only:

- survive tab switches
- survive workspace switches
- survive renderer remounts

then a background host-service owner is enough.

If the goal is also:

- survive full desktop app restart
- survive app crash
- survive quit while keeping sessions alive

then we still need a separate long-lived process. That is effectively a daemon, even if we rename it.

## Recommendation For v2

Short term:

- move v2 terminal semantics toward `createOrAttach` / `detach` / `dispose`
- key everything by `paneId`
- make the mounted pane component attach/detach only

Architecture choice:

- if we only need in-app persistence, merge terminal ownership into host service
- if we need out-of-app persistence, keep a separate terminal owner process and treat host service as a client or facade

## Bottom Line

We probably do not need the current daemon shape exactly.

But we do need the daemon's behavior.

If host service can be the long-lived owner of PTYs, snapshots, and restore state, it can replace the daemon.

If not, the daemon is still the right boundary.
