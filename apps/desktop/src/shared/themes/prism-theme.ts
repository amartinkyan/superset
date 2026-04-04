import type { CSSProperties } from "react";
import { getEditorTheme } from "./editor-theme";
import type { Theme } from "./types";

type PrismStyle = Record<string, CSSProperties>;

/**
 * Build a react-syntax-highlighter (Prism) style object from a Superset theme.
 *
 * Uses the same color derivation pipeline as the diff viewer and CodeMirror
 * editor so that fenced code blocks in markdown are consistent with the rest
 * of the app.
 */
export function getPrismTheme(theme: Theme): PrismStyle {
	const editor = getEditorTheme(theme);
	const { colors, syntax } = editor;

	const shared: CSSProperties = {
		background: colors.background,
		color: syntax.plainText,
		fontFamily:
			'"Fira Code", "Fira Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
		direction: "ltr",
		textAlign: "left",
		whiteSpace: "pre",
		wordSpacing: "normal",
		wordBreak: "normal",
		lineHeight: "1.5",
		tabSize: 2,
	};

	return {
		'code[class*="language-"]': shared,
		'pre[class*="language-"]': {
			...shared,
			padding: "1em",
			margin: "0.5em 0",
			overflow: "auto",
			borderRadius: "0.3em",
		},

		// Selection
		'code[class*="language-"]::selection': {
			background: colors.selection,
			color: "inherit",
		},
		'code[class*="language-"] *::selection': {
			background: colors.selection,
			color: "inherit",
		},
		'pre[class*="language-"] *::selection': {
			background: colors.selection,
			color: "inherit",
		},

		// Inline code
		':not(pre) > code[class*="language-"]': {
			padding: "0.2em 0.3em",
			borderRadius: "0.3em",
			whiteSpace: "normal",
		},

		// Token styles — mapped from EditorSyntaxColors using the same mapping
		// as getEditorTheme (terminal ANSI → syntax category)
		comment: { color: syntax.comment, fontStyle: "italic" },
		prolog: { color: syntax.comment },
		cdata: { color: syntax.comment },

		doctype: { color: syntax.plainText },
		punctuation: { color: syntax.plainText },
		entity: { color: syntax.plainText, cursor: "help" },

		"attr-name": { color: syntax.attributeName },
		"class-name": { color: syntax.className },
		boolean: { color: syntax.constant },
		constant: { color: syntax.constant },
		number: { color: syntax.number },

		atrule: { color: syntax.keyword },
		keyword: { color: syntax.keyword },
		property: { color: syntax.attributeName },

		tag: { color: syntax.tagName },
		symbol: { color: syntax.constant },
		deleted: { color: syntax.regexp },
		important: { color: syntax.keyword },

		selector: { color: syntax.string },
		string: { color: syntax.string },
		char: { color: syntax.string },
		builtin: { color: syntax.typeName },
		inserted: { color: syntax.string },

		regex: { color: syntax.regexp },
		"attr-value": { color: syntax.string },

		variable: { color: syntax.variableName },
		operator: { color: syntax.plainText },
		function: { color: syntax.functionCall },

		bold: { fontWeight: "bold" },
		italic: { fontStyle: "italic" },
		namespace: { opacity: 0.7 },
	};
}
