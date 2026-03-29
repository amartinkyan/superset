import {
	AGENT_LABELS,
	AGENT_PROMPT_COMMANDS,
	AGENT_TYPES,
} from "./agent-command";
import {
	DEFAULT_CHAT_TASK_PROMPT_TEMPLATE,
	DEFAULT_TERMINAL_TASK_PROMPT_TEMPLATE,
} from "./agent-prompt-template";
import { BUILTIN_TERMINAL_AGENTS } from "./builtin-terminal-agents";

export const BUILTIN_AGENT_IDS = [...AGENT_TYPES, "superset-chat"] as const;

export type BuiltinAgentId = (typeof BUILTIN_AGENT_IDS)[number];
export type AgentDefinitionId = BuiltinAgentId | `custom:${string}`;
export type AgentDefinitionSource = "builtin" | "user";
export type AgentKind = "terminal" | "chat";

interface BaseAgentDefinition {
	id: AgentDefinitionId;
	source: AgentDefinitionSource;
	kind: AgentKind;
	defaultLabel: string;
	defaultDescription?: string;
	defaultEnabled: boolean;
}

export interface TerminalAgentDefinition extends BaseAgentDefinition {
	kind: "terminal";
	defaultCommand: string;
	defaultPromptCommand: string;
	defaultPromptCommandSuffix?: string;
	defaultTaskPromptTemplate: string;
}

export interface ChatAgentDefinition extends BaseAgentDefinition {
	kind: "chat";
	defaultTaskPromptTemplate: string;
	defaultModel?: string;
}

export type AgentDefinition = TerminalAgentDefinition | ChatAgentDefinition;

export const BUILTIN_AGENT_LABELS: Record<BuiltinAgentId, string> = {
	...AGENT_LABELS,
	"superset-chat": "Superset Chat",
};

function createBuiltinTerminalAgentDefinition(
	agent: (typeof BUILTIN_TERMINAL_AGENTS)[number],
): TerminalAgentDefinition {
	const promptCommand = AGENT_PROMPT_COMMANDS[agent.id];

	return {
		id: agent.id,
		source: "builtin",
		kind: "terminal",
		defaultLabel: agent.label,
		defaultDescription: agent.description,
		defaultCommand: agent.command,
		defaultPromptCommand: promptCommand.command,
		defaultPromptCommandSuffix: promptCommand.suffix,
		defaultTaskPromptTemplate: DEFAULT_TERMINAL_TASK_PROMPT_TEMPLATE,
		defaultEnabled: true,
	};
}

export const BUILTIN_AGENT_DEFINITIONS: AgentDefinition[] = [
	...BUILTIN_TERMINAL_AGENTS.map((agent) =>
		createBuiltinTerminalAgentDefinition(agent),
	),
	{
		id: "superset-chat",
		source: "builtin",
		kind: "chat",
		defaultLabel: BUILTIN_AGENT_LABELS["superset-chat"],
		defaultDescription:
			"Superset's built-in workspace chat for project-aware help and task launches.",
		defaultTaskPromptTemplate: DEFAULT_CHAT_TASK_PROMPT_TEMPLATE,
		defaultEnabled: true,
	},
];

export function getBuiltinAgentDefinition(id: BuiltinAgentId): AgentDefinition {
	const definition = BUILTIN_AGENT_DEFINITIONS.find((item) => item.id === id);
	if (!definition) {
		throw new Error(`Unknown built-in agent definition: ${id}`);
	}
	return definition;
}

export function isTerminalAgentDefinition(
	definition: AgentDefinition,
): definition is TerminalAgentDefinition {
	return definition.kind === "terminal";
}

export function isChatAgentDefinition(
	definition: AgentDefinition,
): definition is ChatAgentDefinition {
	return definition.kind === "chat";
}

export function isBuiltinAgentId(id: string): id is BuiltinAgentId {
	return (BUILTIN_AGENT_IDS as readonly string[]).includes(id);
}

export function isCustomAgentId(id: string): id is `custom:${string}` {
	return id.startsWith("custom:");
}
