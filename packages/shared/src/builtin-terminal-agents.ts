export interface BuiltinTerminalAgentManifest {
	id: string;
	label: string;
	description: string;
	command: string;
	promptCommand?: string;
	promptCommandSuffix?: string;
	includeInDefaultTerminalPresets?: boolean;
}

type AgentIdTuple<T extends readonly BuiltinTerminalAgentManifest[]> = {
	[K in keyof T]: T[K] extends { id: infer TId } ? TId : never;
};

function mapAgentIds<const T extends readonly BuiltinTerminalAgentManifest[]>(
	agents: T,
): AgentIdTuple<T> {
	return agents.map((agent) => agent.id) as AgentIdTuple<T>;
}

function createAgentRecord<
	const T extends readonly BuiltinTerminalAgentManifest[],
	TValue,
>(
	agents: T,
	getValue: (agent: T[number]) => TValue,
): Record<T[number]["id"], TValue> {
	return Object.fromEntries(
		agents.map((agent) => [agent.id, getValue(agent)]),
	) as Record<T[number]["id"], TValue>;
}

export const BUILTIN_TERMINAL_AGENTS = [
	{
		id: "claude",
		label: "Claude",
		description:
			"Anthropic's coding agent for reading code, editing files, and running terminal workflows.",
		command: "claude --dangerously-skip-permissions",
		includeInDefaultTerminalPresets: true,
	},
	{
		id: "amp",
		label: "Amp",
		description:
			"Amp's coding agent for terminal-first coding, subagents, and task work.",
		command: "amp",
		promptCommand: "amp",
		includeInDefaultTerminalPresets: true,
	},
	{
		id: "codex",
		label: "Codex",
		description:
			"OpenAI's coding agent for reading, modifying, and running code across tasks.",
		command:
			'codex -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox -c model_reasoning_summary="detailed" -c model_supports_reasoning_summaries=true',
		promptCommand:
			'codex -c model_reasoning_effort="high" --dangerously-bypass-approvals-and-sandbox -c model_reasoning_summary="detailed" -c model_supports_reasoning_summaries=true --',
		includeInDefaultTerminalPresets: true,
	},
	{
		id: "gemini",
		label: "Gemini",
		description:
			"Google's open-source terminal agent for coding, problem-solving, and task work.",
		command: "gemini --yolo",
		promptCommand: "gemini",
		promptCommandSuffix: "--yolo",
		includeInDefaultTerminalPresets: true,
	},
	{
		id: "mastracode",
		label: "Mastracode",
		description:
			"Mastra's coding agent for building, debugging, and shipping code from the terminal.",
		command: "mastracode",
		includeInDefaultTerminalPresets: true,
	},
	{
		id: "opencode",
		label: "OpenCode",
		description: "Open-source coding agent for the terminal, IDE, and desktop.",
		command: "opencode",
		promptCommand: "opencode --prompt",
		includeInDefaultTerminalPresets: true,
	},
	{
		id: "pi",
		label: "Pi",
		description:
			"Minimal terminal coding harness for flexible coding workflows.",
		command: "pi",
		includeInDefaultTerminalPresets: true,
	},
	{
		id: "copilot",
		label: "Copilot",
		description:
			"GitHub's coding agent for planning, editing, and building in your repo.",
		command: "copilot --allow-all",
		promptCommand: "copilot -i --allow-all",
		promptCommandSuffix: "--yolo",
		includeInDefaultTerminalPresets: true,
	},
	{
		id: "cursor-agent",
		label: "Cursor Agent",
		description:
			"Cursor's coding agent for editing, running, and debugging code in parallel.",
		command: "cursor-agent",
		promptCommandSuffix: "--yolo",
	},
] as const satisfies readonly BuiltinTerminalAgentManifest[];

export type BuiltinTerminalAgentType =
	(typeof BUILTIN_TERMINAL_AGENTS)[number]["id"];

export const BUILTIN_TERMINAL_AGENT_TYPES = mapAgentIds(
	BUILTIN_TERMINAL_AGENTS,
);

export const BUILTIN_TERMINAL_AGENT_LABELS = createAgentRecord(
	BUILTIN_TERMINAL_AGENTS,
	(agent) => agent.label,
);

export const BUILTIN_TERMINAL_AGENT_DESCRIPTIONS = createAgentRecord(
	BUILTIN_TERMINAL_AGENTS,
	(agent) => agent.description,
);

export const BUILTIN_TERMINAL_AGENT_COMMANDS = createAgentRecord(
	BUILTIN_TERMINAL_AGENTS,
	(agent) => [agent.command],
);

export const BUILTIN_TERMINAL_AGENT_PROMPT_COMMANDS = createAgentRecord(
	BUILTIN_TERMINAL_AGENTS,
	(agent) => ({
		command: "promptCommand" in agent ? agent.promptCommand : agent.command,
		suffix:
			"promptCommandSuffix" in agent ? agent.promptCommandSuffix : undefined,
	}),
);

export const DEFAULT_TERMINAL_PRESET_AGENT_TYPES =
	BUILTIN_TERMINAL_AGENTS.filter(
		(agent) =>
			"includeInDefaultTerminalPresets" in agent &&
			agent.includeInDefaultTerminalPresets,
	).map((agent) => agent.id) satisfies BuiltinTerminalAgentType[];
