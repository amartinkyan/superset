import { describe, expect, test } from "bun:test";
import {
	APP_NAME,
	DEFAULT_WINDOW_TITLE_FORMAT,
	formatWindowTitle,
} from "./window-title";

describe("formatWindowTitle", () => {
	test("formats with all variables populated", () => {
		const result = formatWindowTitle(DEFAULT_WINDOW_TITLE_FORMAT, {
			workspace: "my-project - feature-auth",
			branch: "feature/auth",
			tab: "Terminal 1",
			pane: "~/Projects/superset",
		});
		expect(result).toBe(
			"my-project - feature-auth (feature/auth) \u2014 Terminal 1 \u00b7 ~/Projects/superset \u2014 Superset",
		);
	});

	test("collapses separator when middle segment is empty", () => {
		const result = formatWindowTitle(DEFAULT_WINDOW_TITLE_FORMAT, {
			workspace: "my-project",
			branch: "main",
		});
		expect(result).toBe("my-project (main) \u2014 Superset");
	});

	test("collapses when workspace/branch are empty but tab/pane populated", () => {
		const result = formatWindowTitle(DEFAULT_WINDOW_TITLE_FORMAT, {
			tab: "Terminal 1",
			pane: "~/home",
		});
		expect(result).toBe("Terminal 1 \u00b7 ~/home \u2014 Superset");
	});

	test("returns app name when all variables are empty", () => {
		const result = formatWindowTitle(DEFAULT_WINDOW_TITLE_FORMAT, {});
		expect(result).toBe(APP_NAME);
	});

	test("handles simple format with just appName", () => {
		const result = formatWindowTitle("${appName}", {});
		expect(result).toBe("Superset");
	});

	test("handles format without separators", () => {
		const result = formatWindowTitle("${workspace} - ${branch}", {
			workspace: "project",
			branch: "main",
		});
		expect(result).toBe("project - main");
	});

	test("uses custom appName", () => {
		const result = formatWindowTitle("${appName}", {
			appName: "Custom App",
		});
		expect(result).toBe("Custom App");
	});

	test("handles non-workspace page format", () => {
		const result = formatWindowTitle("${tab}${separator}${appName}", {
			tab: "Settings",
		});
		expect(result).toBe("Settings \u2014 Superset");
	});

	test("handles tab populated but pane empty", () => {
		const result = formatWindowTitle(DEFAULT_WINDOW_TITLE_FORMAT, {
			workspace: "my-project",
			branch: "main",
			tab: "Terminal 1",
		});
		expect(result).toBe("my-project (main) \u2014 Terminal 1 \u2014 Superset");
	});

	test("handles pane populated but tab empty", () => {
		const result = formatWindowTitle(DEFAULT_WINDOW_TITLE_FORMAT, {
			workspace: "my-project",
			branch: "main",
			pane: "~/Projects/superset",
		});
		expect(result).toBe(
			"my-project (main) \u2014 ~/Projects/superset \u2014 Superset",
		);
	});

	test("handles workspace without branch", () => {
		const result = formatWindowTitle(DEFAULT_WINDOW_TITLE_FORMAT, {
			workspace: "my-project",
			tab: "Terminal 1",
		});
		expect(result).toBe("my-project \u2014 Terminal 1 \u2014 Superset");
	});
});
