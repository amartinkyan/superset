import ampIcon from "./amp.svg";
import claudeIcon from "./claude.svg";
import codexIcon from "./codex.svg";
import codexWhiteIcon from "./codex-white.svg";
import copilotIcon from "./copilot.svg";
import copilotWhiteIcon from "./copilot-white.svg";
import cursorAgentIcon from "./cursor.svg";
import geminiIcon from "./gemini.svg";
import mastracodeIcon from "./mastracode.svg";
import mastracodeWhiteIcon from "./mastracode-white.svg";
import opencodeIcon from "./opencode.svg";
import opencodeWhiteIcon from "./opencode-white.svg";
import piIcon from "./pi.svg";
import piWhiteIcon from "./pi-white.svg";
import supersetIcon from "./superset.svg";

export interface PresetIconSet {
	light: string;
	dark: string;
}

export const PRESET_ICONS: Record<string, PresetIconSet> = {
	amp: { light: ampIcon, dark: ampIcon },
	claude: { light: claudeIcon, dark: claudeIcon },
	codex: { light: codexIcon, dark: codexWhiteIcon },
	copilot: { light: copilotIcon, dark: copilotWhiteIcon },
	gemini: { light: geminiIcon, dark: geminiIcon },
	pi: { light: piIcon, dark: piWhiteIcon },
	superset: { light: supersetIcon, dark: supersetIcon },
	"superset-chat": { light: supersetIcon, dark: supersetIcon },
	"cursor-agent": { light: cursorAgentIcon, dark: cursorAgentIcon },
	mastracode: { light: mastracodeIcon, dark: mastracodeWhiteIcon },
	opencode: { light: opencodeIcon, dark: opencodeWhiteIcon },
};

/**
 * Check whether a string is a single emoji (one grapheme cluster outside ASCII).
 */
const EMOJI_REGEX =
	/^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;

export function isEmoji(value: string): boolean {
	return EMOJI_REGEX.test(value);
}

export type PresetIconResult =
	| { type: "img"; src: string }
	| { type: "emoji"; emoji: string }
	| undefined;

/**
 * Resolve a preset icon. Priority:
 * 1. If `iconOverride` is set and is an emoji → return emoji
 * 2. If `iconOverride` is set and matches a PRESET_ICONS key → return that icon
 * 3. Fall back to matching `presetName` against PRESET_ICONS
 * 4. Return undefined (caller renders generic fallback)
 */
export function resolvePresetIcon(
	presetName: string,
	isDark: boolean,
	iconOverride?: string,
): PresetIconResult {
	if (iconOverride) {
		const trimmed = iconOverride.trim();
		if (trimmed && isEmoji(trimmed)) {
			return { type: "emoji", emoji: trimmed };
		}
		const overrideSet = PRESET_ICONS[trimmed.toLowerCase()];
		if (overrideSet) {
			return {
				type: "img",
				src: isDark ? overrideSet.dark : overrideSet.light,
			};
		}
	}

	const normalizedName = presetName.toLowerCase().trim();
	const iconSet = PRESET_ICONS[normalizedName];
	if (!iconSet) return undefined;
	return { type: "img", src: isDark ? iconSet.dark : iconSet.light };
}

export function getPresetIcon(
	presetName: string,
	isDark: boolean,
): string | undefined {
	const result = resolvePresetIcon(presetName, isDark);
	if (result?.type === "img") return result.src;
	return undefined;
}

export {
	ampIcon,
	claudeIcon,
	codexIcon,
	codexWhiteIcon,
	copilotIcon,
	copilotWhiteIcon,
	cursorAgentIcon,
	geminiIcon,
	mastracodeIcon,
	mastracodeWhiteIcon,
	opencodeIcon,
	opencodeWhiteIcon,
	piIcon,
	piWhiteIcon,
	supersetIcon,
};
