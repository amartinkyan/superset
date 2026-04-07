import type { FsWatchEvent } from "@superset/workspace-fs/host";

// ── Server → Client ────────────────────────────────────────────────

export interface FsEventsMessage {
	type: "fs:events";
	workspaceId: string;
	events: FsWatchEvent[];
}

export interface GitChangedMessage {
	type: "git:changed";
	workspaceId: string;
}

export interface EventBusErrorMessage {
	type: "error";
	message: string;
}

export interface WorkspaceInitChangedMessage {
	type: "workspace:init:changed";
	workspaceId: string;
	init: { phase: string; progress: number | null };
}

export type ServerMessage =
	| FsEventsMessage
	| GitChangedMessage
	| WorkspaceInitChangedMessage
	| EventBusErrorMessage;

// ── Client → Server ────────────────────────────────────────────────

export interface FsWatchCommand {
	type: "fs:watch";
	workspaceId: string;
}

export interface FsUnwatchCommand {
	type: "fs:unwatch";
	workspaceId: string;
}

export type ClientMessage = FsWatchCommand | FsUnwatchCommand;
