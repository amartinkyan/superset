/**
 * Window title formatting with template variable support.
 *
 * Variables: ${workspace}, ${branch}, ${tab}, ${pane}, ${appName}, ${separator}
 *
 * ${separator} collapses intelligently: if a variable between two separators
 * is empty, only one separator renders instead of two.
 */

export const DEFAULT_WINDOW_TITLE_FORMAT =
	"${workspace} (${branch})${separator}${tab} · ${pane}${separator}${appName}";

export const APP_NAME = "Superset";

export interface WindowTitleVariables {
	workspace?: string;
	branch?: string;
	tab?: string;
	pane?: string;
	appName?: string;
}

/**
 * Format a window title from a template string and variables.
 *
 * Template variables are replaced with their values. Empty variables
 * are removed along with adjacent literal text up to the next separator.
 * Consecutive separators are collapsed into one.
 */
export function formatWindowTitle(
	format: string,
	variables: WindowTitleVariables,
): string {
	const vars: Record<string, string> = {
		workspace: variables.workspace ?? "",
		branch: variables.branch ?? "",
		tab: variables.tab ?? "",
		pane: variables.pane ?? "",
		appName: variables.appName ?? APP_NAME,
	};

	const SEPARATOR = " \u2014 ";
	const SEPARATOR_TOKEN = "$" + "{separator}";
	const segments = format.split(SEPARATOR_TOKEN);

	const resolvedSegments = segments.map((segment) =>
		resolveSegment(segment, vars),
	);

	const nonEmpty = resolvedSegments.filter((s) => s.length > 0);

	return nonEmpty.join(SEPARATOR) || APP_NAME;
}

/**
 * Resolve a segment by replacing variables and cleaning up punctuation
 * left behind by empty variables.
 */
function resolveSegment(segment: string, vars: Record<string, string>): string {
	// Check if any variable in this segment has a value
	let hasAnyValue = false;

	const resolved = segment.replace(/\$\{(\w+)\}/g, (_match, key: string) => {
		const val = vars[key] ?? "";
		if (val) hasAnyValue = true;
		return val;
	});

	// If no variable in this segment had a value, collapse the entire segment
	if (!hasAnyValue) return "";

	// Clean up orphaned punctuation from empty variables:
	// - Remove empty parentheses like "( )" or "()"
	// - Collapse multiple spaces
	// - Remove orphaned separators like " · " at start/end or doubled
	return resolved
		.replace(/\(\s*\)/g, "") // remove empty parens
		.replace(/\s+/g, " ") // collapse whitespace
		.replace(/(?:^[\s·]+|[\s·]+$)/g, "") // trim leading/trailing dots and spaces
		.replace(/\s*·\s*·\s*/g, " · ") // collapse doubled middot separators
		.trim();
}
