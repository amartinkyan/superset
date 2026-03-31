import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Reproduction test for https://github.com/anthropics/superset/issues/3055
 *
 * The Codex session-log watcher in codex-wrapper-exec.template.sh uses shell
 * `case` patterns to detect lifecycle events. These patterns look for:
 *   - "kind":"codex_event" + "msg":{"type":"task_started"}
 *   - "kind":"codex_event" + "msg":{"type":"..._approval_request"}
 *   - "kind":"codex_event" + "msg":{"type":"exec_command_begin"}
 *
 * Codex CLI 0.117.0 changed its session-log format: events now use
 * "kind":"app_event" with "variant":"..." instead of the old structure.
 * As a result, zero log lines match the watcher's grep patterns, and
 * Start / PermissionRequest notifications are never dispatched.
 */

const TEST_DIR = path.join(
	os.tmpdir(),
	`superset-codex-watcher-test-${process.pid}-${Date.now()}`,
);

const TEMPLATE_PATH = path.join(
	__dirname,
	"templates",
	"codex-wrapper-exec.template.sh",
);

let scriptPath: string;

/**
 * Extracts the `case` block from the codex wrapper template and wraps it in
 * a small shell harness that reads lines from stdin, runs them through the
 * case patterns, and prints any matched event name to stdout.
 */
function buildPatternTestScript(): string {
	const template = readFileSync(TEMPLATE_PATH, "utf-8");

	const caseMatch = template.match(
		/(\s*case "\$_superset_line" in[\s\S]*?esac)/,
	);
	if (!caseMatch) {
		throw new Error("Could not find case…esac block in codex wrapper template");
	}
	const caseBlock = caseMatch[1];

	return `#!/bin/bash
set -euo pipefail

_superset_last_turn_id=""
_superset_last_approval_id=""
_superset_last_exec_call_id=""
_superset_approval_fallback_seq=0

_superset_emit_event() {
  echo "$1"
}

while IFS= read -r _superset_line; do
${caseBlock}
done
`;
}

/** Feed lines through the case-pattern harness, return matched events. */
function matchEvents(lines: string[]): string[] {
	// Trailing newline is required — `read -r` returns non-zero at EOF
	// without one, and `set -e` would cause an early exit.
	const input = `${lines.join("\n")}\n`;
	try {
		const output = execFileSync("bash", [scriptPath], {
			input,
			encoding: "utf-8",
			timeout: 5000,
		});
		return output.trim().split("\n").filter(Boolean);
	} catch {
		return [];
	}
}

// --- Sample log lines ---------------------------------------------------

/** Old format (pre-0.117.0): "kind":"codex_event" + "msg":{"type":"…"} */
const OLD_FORMAT_TASK_STARTED =
	'{"ts":1,"dir":"to_tui","kind":"codex_event","msg":{"type":"task_started","turn_id":"t1"}}';
const OLD_FORMAT_APPROVAL_REQUEST =
	'{"ts":2,"dir":"to_tui","kind":"codex_event","msg":{"type":"tool_approval_request","id":"a1"}}';
const OLD_FORMAT_EXEC_COMMAND_BEGIN =
	'{"ts":3,"dir":"to_tui","kind":"codex_event","msg":{"type":"exec_command_begin","call_id":"c1"}}';

/** New format (0.117.0+): "kind":"app_event" + "variant":"…" */
const NEW_FORMAT_TASK_STARTED =
	'{"ts":1,"dir":"to_tui","kind":"app_event","variant":"task_started","turn_id":"t1"}';
const NEW_FORMAT_APPROVAL_REQUEST =
	'{"ts":2,"dir":"to_tui","kind":"app_event","variant":"tool_approval_request","id":"a1"}';
const NEW_FORMAT_EXEC_COMMAND_BEGIN =
	'{"ts":3,"dir":"to_tui","kind":"app_event","variant":"exec_command_begin","call_id":"c1"}';

/** Unrelated lines that should never match */
const IRRELEVANT_SESSION_START =
	'{"ts":0,"dir":"to_tui","kind":"session_start"}';
const IRRELEVANT_OP = '{"ts":4,"dir":"to_tui","kind":"op","data":{}}';

describe("codex watcher case patterns (issue #3055)", () => {
	beforeAll(() => {
		mkdirSync(TEST_DIR, { recursive: true });
		scriptPath = path.join(TEST_DIR, "test-patterns.sh");
		const script = buildPatternTestScript();
		writeFileSync(scriptPath, script, { mode: 0o755 });
	});

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	// -- Old format: the watcher should detect all three event types ----------

	it("matches old-format task_started → Start", () => {
		const events = matchEvents([OLD_FORMAT_TASK_STARTED]);
		expect(events).toContain("Start");
	});

	it("matches old-format approval_request → PermissionRequest", () => {
		const events = matchEvents([OLD_FORMAT_APPROVAL_REQUEST]);
		expect(events).toContain("PermissionRequest");
	});

	it("matches old-format exec_command_begin → Start", () => {
		const events = matchEvents([OLD_FORMAT_EXEC_COMMAND_BEGIN]);
		expect(events).toContain("Start");
	});

	// -- New format (0.117.0): the watcher SHOULD detect these, but currently
	//    does NOT because the patterns only look for "kind":"codex_event".
	//    These tests document the bug. -----------------------------------------

	it("matches new-format (app_event) task_started → Start", () => {
		const events = matchEvents([NEW_FORMAT_TASK_STARTED]);
		expect(events).toContain("Start");
	});

	it("matches new-format (app_event) approval_request → PermissionRequest", () => {
		const events = matchEvents([NEW_FORMAT_APPROVAL_REQUEST]);
		expect(events).toContain("PermissionRequest");
	});

	it("matches new-format (app_event) exec_command_begin → Start", () => {
		const events = matchEvents([NEW_FORMAT_EXEC_COMMAND_BEGIN]);
		expect(events).toContain("Start");
	});

	// -- Irrelevant lines should never emit events ----------------------------

	it("does not match irrelevant log lines", () => {
		const events = matchEvents([IRRELEVANT_SESSION_START, IRRELEVANT_OP]);
		expect(events).toEqual([]);
	});
});
