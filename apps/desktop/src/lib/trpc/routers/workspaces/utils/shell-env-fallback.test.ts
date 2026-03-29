import { describe, expect, test } from "bun:test";
import { augmentPathForMacOS, augmentPathForWindows } from "./shell-env";

describe("augmentPathForMacOS", () => {
	test("adds common macOS paths when they are missing", () => {
		const env: Record<string, string> = {
			PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
		};
		augmentPathForMacOS(env, "darwin");

		expect(env.PATH).toContain("/opt/homebrew/bin");
		expect(env.PATH).toContain("/opt/homebrew/sbin");
		expect(env.PATH).toContain("/usr/local/bin");
		expect(env.PATH).toContain("/usr/local/sbin");
		// Original paths should still be present
		expect(env.PATH).toContain("/usr/bin");
		expect(env.PATH).toContain("/bin");
	});

	test("does not duplicate paths already present", () => {
		const env: Record<string, string> = {
			PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
		};
		augmentPathForMacOS(env, "darwin");

		const entries = env.PATH.split(":");
		const homebrewBinCount = entries.filter(
			(entry) => entry === "/opt/homebrew/bin",
		).length;
		expect(homebrewBinCount).toBe(1);
	});

	test("handles empty PATH", () => {
		const env: Record<string, string> = { PATH: "" };
		augmentPathForMacOS(env, "darwin");

		expect(env.PATH).toContain("/opt/homebrew/bin");
		expect(env.PATH).toContain("/usr/local/bin");
	});

	test("handles missing PATH key", () => {
		const env: Record<string, string> = {};
		augmentPathForMacOS(env, "darwin");

		expect(env.PATH).toContain("/opt/homebrew/bin");
		expect(env.PATH).toContain("/usr/local/bin");
	});

	test("matches PATH entries exactly instead of using substrings", () => {
		const env: Record<string, string> = {
			PATH: "/usr/local/bin-tools:/usr/bin:/bin",
		};
		augmentPathForMacOS(env, "darwin");

		expect(env.PATH.split(":")).toContain("/usr/local/bin");
	});

	test("preserves existing PATH separators when nothing needs to be added", () => {
		const originalPath =
			"/opt/homebrew/bin::/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:";
		const env: Record<string, string> = {
			PATH: originalPath,
		};
		augmentPathForMacOS(env, "darwin");

		expect(env.PATH).toBe(originalPath);
	});

	test("does nothing outside macOS", () => {
		const env: Record<string, string> = {
			PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
		};
		augmentPathForMacOS(env, "linux");

		expect(env.PATH).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
	});
});

describe("augmentPathForWindows", () => {
	test("adds common Windows git paths when they are missing", () => {
		const env: Record<string, string> = {
			PATH: "C:\\Windows\\system32;C:\\Windows",
		};
		augmentPathForWindows(env, "win32");

		expect(env.PATH).toContain("C:\\Program Files\\Git\\cmd");
		expect(env.PATH).toContain("C:\\Program Files (x86)\\Git\\cmd");
		expect(env.PATH).toContain("C:\\Program Files\\Git\\bin");
		// Original paths should still be present
		expect(env.PATH).toContain("C:\\Windows\\system32");
		expect(env.PATH).toContain("C:\\Windows");
	});

	test("does not duplicate paths already present", () => {
		const env: Record<string, string> = {
			PATH: "C:\\Program Files\\Git\\cmd;C:\\Windows\\system32",
		};
		augmentPathForWindows(env, "win32");

		const entries = env.PATH.split(";");
		const gitCmdCount = entries.filter(
			(entry) => entry === "C:\\Program Files\\Git\\cmd",
		).length;
		expect(gitCmdCount).toBe(1);
	});

	test("handles case-insensitive path comparison on Windows", () => {
		const env: Record<string, string> = {
			PATH: "c:\\program files\\git\\cmd;C:\\Windows",
		};
		augmentPathForWindows(env, "win32");

		// Should not duplicate "C:\Program Files\Git\cmd" since the lowercase form already exists
		const entries = env.PATH.split(";").filter(
			(e) => e.toLowerCase() === "c:\\program files\\git\\cmd",
		);
		expect(entries.length).toBe(1);
	});

	test("handles empty PATH", () => {
		const env: Record<string, string> = { PATH: "" };
		augmentPathForWindows(env, "win32");

		expect(env.PATH).toContain("C:\\Program Files\\Git\\cmd");
	});

	test("handles missing PATH key", () => {
		const env: Record<string, string> = {};
		augmentPathForWindows(env, "win32");

		expect(env.PATH).toContain("C:\\Program Files\\Git\\cmd");
	});

	test("uses Path key when present (Windows convention)", () => {
		const env: Record<string, string> = {
			Path: "C:\\Windows\\system32",
		};
		augmentPathForWindows(env, "win32");

		expect(env.Path).toContain("C:\\Program Files\\Git\\cmd");
		// Should also sync to PATH
		expect(env.PATH).toBe(env.Path);
	});

	test("does nothing outside Windows", () => {
		const env: Record<string, string> = {
			PATH: "/usr/bin:/bin",
		};
		augmentPathForWindows(env, "darwin");

		expect(env.PATH).toBe("/usr/bin:/bin");
	});
});
