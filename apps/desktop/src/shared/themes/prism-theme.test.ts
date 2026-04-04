import { describe, expect, it } from "bun:test";
import { darkTheme, lightTheme } from "./built-in";
import { getEditorTheme } from "./editor-theme";
import { getPrismTheme } from "./prism-theme";
import type { Theme } from "./types";

describe("getPrismTheme", () => {
	it("derives code block background from theme, not hardcoded oneLight/oneDark", () => {
		const prism = getPrismTheme(lightTheme);
		const editor = getEditorTheme(lightTheme);

		const preStyle = prism['pre[class*="language-"]'];
		expect(preStyle?.background).toBe(editor.colors.background);
		expect(preStyle?.color).toBe(editor.syntax.plainText);
	});

	it("maps syntax token colors from editor theme for dark theme", () => {
		const prism = getPrismTheme(darkTheme);
		const editor = getEditorTheme(darkTheme);

		expect(prism.comment?.color).toBe(editor.syntax.comment);
		expect(prism.keyword?.color).toBe(editor.syntax.keyword);
		expect(prism.string?.color).toBe(editor.syntax.string);
		expect(prism.number?.color).toBe(editor.syntax.number);
		expect(prism.function?.color).toBe(editor.syntax.functionCall);
		expect(prism.variable?.color).toBe(editor.syntax.variableName);
		expect(prism.regex?.color).toBe(editor.syntax.regexp);
		expect(prism.tag?.color).toBe(editor.syntax.tagName);
		expect(prism["attr-name"]?.color).toBe(editor.syntax.attributeName);
		expect(prism["class-name"]?.color).toBe(editor.syntax.className);
		expect(prism.builtin?.color).toBe(editor.syntax.typeName);
		expect(prism.constant?.color).toBe(editor.syntax.constant);
	});

	it("uses custom theme colors when a tinted background is set", () => {
		// Simulates the Iceberg Light scenario from the issue:
		// a light theme with a tinted background that clashes with oneLight's
		// pastel token colors designed for pure white.
		const icebergLike: Theme = {
			...lightTheme,
			id: "iceberg-light-test",
			name: "Iceberg Light Test",
			type: "light",
			ui: {
				...lightTheme.ui,
				background: "#e8e9ec",
				foreground: "#33374c",
				muted: "#d2d4dc",
				mutedForeground: "#8389a3",
			},
			terminal: {
				background: "#e8e9ec",
				foreground: "#33374c",
				cursor: "#33374c",
				black: "#1e2132",
				red: "#cc517a",
				green: "#668e3d",
				yellow: "#c57339",
				blue: "#2d539e",
				magenta: "#7759b4",
				cyan: "#3f83a6",
				white: "#c6c8d1",
				brightBlack: "#6b7089",
				brightRed: "#cc3768",
				brightGreen: "#85a047",
				brightYellow: "#b6662d",
				brightBlue: "#5079be",
				brightMagenta: "#845dc4",
				brightCyan: "#3d96b8",
				brightWhite: "#d2d4dc",
			},
		};

		const prism = getPrismTheme(icebergLike);

		// Background should be the theme's tinted background, NOT oneLight's #fafafa
		expect(prism['pre[class*="language-"]']?.background).toBe("#e8e9ec");
		// Keyword should use magenta from terminal, not oneLight's hardcoded purple
		expect(prism.keyword?.color).toBe("#7759b4");
		// String should use green from terminal
		expect(prism.string?.color).toBe("#668e3d");
		// Function should use blue from terminal
		expect(prism.function?.color).toBe("#2d539e");
	});

	it("respects editor overrides", () => {
		const customTheme: Theme = {
			...darkTheme,
			editor: {
				colors: { background: "#1a1b26" },
				syntax: { string: "#9ece6a" },
			},
		};

		const prism = getPrismTheme(customTheme);

		expect(prism['pre[class*="language-"]']?.background).toBe("#1a1b26");
		expect(prism.string?.color).toBe("#9ece6a");
	});

	it("falls back to ui colors when terminal colors are not provided", () => {
		const noTerminal: Theme = {
			...lightTheme,
			terminal: undefined,
			editor: undefined,
		};

		const prism = getPrismTheme(noTerminal);
		const editor = getEditorTheme(noTerminal);

		expect(prism.keyword?.color).toBe(editor.syntax.keyword);
		expect(prism.string?.color).toBe(editor.syntax.string);
		expect(prism.function?.color).toBe(editor.syntax.functionCall);
	});
});
