export interface FilePaneData {
	filePath: string;
	mode: "editor" | "diff" | "preview";
	hasChanges: boolean;
	language?: string;
}

export interface TerminalPaneData {
	terminalId: string;
	initialCommand?: string;
}

export interface ChatLaunchConfig {
	initialPrompt?: string;
	draftInput?: string;
	initialFiles?: Array<{
		data: string;
		mediaType: string;
		filename?: string;
	}>;
	metadata?: {
		model?: string;
	};
}

export interface ChatPaneData {
	sessionId: string | null;
	draft?: string;
	launchConfig?: ChatLaunchConfig | null;
}

export interface BrowserPaneData {
	url: string;
	mode: "docs" | "preview" | "generic";
}

export interface DevtoolsPaneData {
	targetPaneId: string;
	targetTitle: string;
}

export type PaneViewerData =
	| FilePaneData
	| TerminalPaneData
	| ChatPaneData
	| BrowserPaneData
	| DevtoolsPaneData;
