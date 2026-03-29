import {
	DEFAULT_TERMINAL_TASK_PROMPT_TEMPLATE,
	renderTaskPromptTemplate,
} from "./agent-prompt-template";
import {
	BUILTIN_TERMINAL_AGENT_COMMANDS,
	BUILTIN_TERMINAL_AGENT_DESCRIPTIONS,
	BUILTIN_TERMINAL_AGENT_LABELS,
	BUILTIN_TERMINAL_AGENT_PROMPT_COMMANDS,
	BUILTIN_TERMINAL_AGENT_TYPES,
	type BuiltinTerminalAgentType,
} from "./builtin-terminal-agents";

export {
	BUILTIN_TERMINAL_AGENTS,
	DEFAULT_TERMINAL_PRESET_AGENT_TYPES,
} from "./builtin-terminal-agents";

export const AGENT_TYPES = BUILTIN_TERMINAL_AGENT_TYPES;

export type AgentType = BuiltinTerminalAgentType;

export const AGENT_LABELS: Record<AgentType, string> =
	BUILTIN_TERMINAL_AGENT_LABELS;

export const AGENT_PRESET_COMMANDS: Record<AgentType, string[]> =
	BUILTIN_TERMINAL_AGENT_COMMANDS;

export const AGENT_PRESET_DESCRIPTIONS: Record<AgentType, string> =
	BUILTIN_TERMINAL_AGENT_DESCRIPTIONS;

export interface AgentPromptCommandDefaults {
	command: string;
	suffix?: string;
}

export const AGENT_PROMPT_COMMANDS: Record<
	AgentType,
	AgentPromptCommandDefaults
> = BUILTIN_TERMINAL_AGENT_PROMPT_COMMANDS;

export interface TaskInput {
	id: string;
	slug: string;
	title: string;
	description: string | null;
	priority: string;
	statusName: string | null;
	labels: string[] | null;
}

export function buildAgentTaskPrompt(task: TaskInput): string {
	return renderTaskPromptTemplate(DEFAULT_TERMINAL_TASK_PROMPT_TEMPLATE, task);
}

function buildHeredoc(
	prompt: string,
	delimiter: string,
	command: string,
	suffix?: string,
): string {
	const closing = suffix ? `)" ${suffix}` : ')"';
	return [
		`${command} "$(cat <<'${delimiter}'`,
		prompt,
		delimiter,
		closing,
	].join("\n");
}

function buildFileCommand(
	filePath: string,
	command: string,
	suffix?: string,
): string {
	const escapedPath = filePath.replaceAll("'", "'\\''");
	return `${command} "$(cat '${escapedPath}')"${suffix ? ` ${suffix}` : ""}`;
}

export function buildAgentFileCommand({
	filePath,
	agent = "claude",
}: {
	filePath: string;
	agent?: AgentType;
}): string {
	const promptCommand = AGENT_PROMPT_COMMANDS[agent];
	return buildFileCommand(
		filePath,
		promptCommand.command,
		promptCommand.suffix,
	);
}

export function buildAgentPromptCommand({
	prompt,
	randomId,
	agent = "claude",
}: {
	prompt: string;
	randomId: string;
	agent?: AgentType;
}): string {
	let delimiter = `SUPERSET_PROMPT_${randomId.replaceAll("-", "")}`;
	while (prompt.includes(delimiter)) {
		delimiter = `${delimiter}_X`;
	}
	const promptCommand = AGENT_PROMPT_COMMANDS[agent];
	return buildHeredoc(
		prompt,
		delimiter,
		promptCommand.command,
		promptCommand.suffix,
	);
}

export function buildAgentCommand({
	task,
	randomId,
	agent = "claude",
}: {
	task: TaskInput;
	randomId: string;
	agent?: AgentType;
}): string {
	const prompt = buildAgentTaskPrompt(task);
	return buildAgentPromptCommand({ prompt, randomId, agent });
}

/** @deprecated Use `buildAgentCommand` instead */
export function buildClaudeCommand({
	task,
	randomId,
}: {
	task: TaskInput;
	randomId: string;
}): string {
	return buildAgentCommand({ task, randomId, agent: "claude" });
}
