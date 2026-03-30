import type { PaneRegistry, RendererContext } from "@superset/panes";
import { FileCode2, Globe, MessageSquare, TerminalSquare } from "lucide-react";
import { useMemo } from "react";
import { WorkspaceChat } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceChat";
import { WorkspaceFilePreview } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceFiles/components/WorkspaceFilePreview/WorkspaceFilePreview";
import { WorkspaceTerminal } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceTerminal";
import type {
	BrowserPaneData,
	ChatPaneData,
	DevtoolsPaneData,
	FilePaneData,
	PaneViewerData,
} from "../../pane-viewer.model";

function getFileTitle(filePath: string): string {
	return filePath.split("/").pop() ?? filePath;
}

export function usePaneRegistry(
	workspaceId: string,
): PaneRegistry<PaneViewerData> {
	return useMemo<PaneRegistry<PaneViewerData>>(
		() => ({
			file: {
				getIcon: () => <FileCode2 className="size-4" />,
				getTitle: (ctx: RendererContext<PaneViewerData>) => {
					const data = ctx.pane.data as FilePaneData;
					return getFileTitle(data.filePath);
				},
				renderPane: (ctx: RendererContext<PaneViewerData>) => {
					const data = ctx.pane.data as FilePaneData;
					return (
						<WorkspaceFilePreview
							selectedFilePath={data.filePath}
							workspaceId={workspaceId}
						/>
					);
				},
			},
			terminal: {
				getIcon: () => <TerminalSquare className="size-4" />,
				getTitle: () => "Terminal",
				renderPane: () => (
					<WorkspaceTerminal workspaceId={workspaceId} />
				),
			},
			browser: {
				getIcon: () => <Globe className="size-4" />,
				getTitle: (ctx: RendererContext<PaneViewerData>) => {
					const data = ctx.pane.data as BrowserPaneData;
					return data.url;
				},
				renderPane: (ctx: RendererContext<PaneViewerData>) => {
					const data = ctx.pane.data as BrowserPaneData;
					return (
						<iframe
							className="h-full w-full border-0 bg-background"
							src={data.url}
							title={ctx.pane.titleOverride ?? "Browser"}
						/>
					);
				},
			},
			chat: {
				getIcon: () => <MessageSquare className="size-4" />,
				getTitle: () => "Chat",
				renderPane: (ctx: RendererContext<PaneViewerData>) => {
					const data = ctx.pane.data as ChatPaneData;
					return (
						<WorkspaceChat
							onSessionIdChange={(sessionId) =>
								ctx.actions.updateData({
									sessionId,
								} as PaneViewerData)
							}
							sessionId={data.sessionId}
							workspaceId={workspaceId}
						/>
					);
				},
			},
			devtools: {
				getTitle: () => "DevTools",
				renderPane: (ctx: RendererContext<PaneViewerData>) => {
					const data = ctx.pane.data as DevtoolsPaneData;
					return (
						<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
							Inspecting {data.targetTitle}
						</div>
					);
				},
			},
		}),
		[workspaceId],
	);
}
