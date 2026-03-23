/**
 * Reproduction test for issue #2784:
 * Upgrading from 1.2.4 to 1.3.x loses all previous repos/workspaces.
 *
 * Root cause: Migration 0032 originally used custom SQLite functions (uuid_v4,
 * uuid_is_valid_v4) that are registered via better-sqlite3's function() API.
 * Drizzle runs ALL pending migrations in a single transaction — if migration
 * 0032 fails because the custom functions aren't available, ALL new migrations
 * (0030–0037) are rolled back. The app catches the error and continues, but
 * the schema code references columns/tables that don't exist, causing all
 * queries to fail silently (returning empty data to the UI).
 *
 * The fix replaces the custom function calls with pure SQL equivalents so the
 * migration works in any SQLite environment without depending on application-
 * level function registration.
 */

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const DRIZZLE_DIR = join(import.meta.dir);

/** Reads a migration SQL file and splits it into individual statements. */
function readMigration(tag: string): string[] {
	const sql = readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), "utf-8");
	return sql
		.split("--> statement-breakpoint")
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Runs all statements from a migration against the given database. */
function runMigration(db: Database, tag: string): void {
	for (const stmt of readMigration(tag)) {
		db.run(stmt);
	}
}

/** Creates a fresh in-memory database with pre-1.3.x schema (through migration 0029). */
function createPreUpgradeDb(): Database {
	const db = new Database(":memory:");

	// Core schema migrations that existed before the 1.3.x upgrade
	const preMigrations = [
		"0000_initial_schema",
		"0006_add_unique_branch_workspace_index",
		"0007_add_workspace_is_unread",
		"0009_add_github_owner_to_projects",
		"0010_add_workspace_deleting_at",
		"0014_add_branch_prefix_config",
		"0017_add_is_unnamed_to_workspaces",
		"0019_add_hide_image_to_projects",
		"0021_add_image_project",
		"0022_add_port_config",
		"0025_add_neon_project_id",
		"0027_per_project_default_app",
		"0029_add_workspace_base_branch",
	];

	for (const tag of preMigrations) {
		try {
			runMigration(db, tag);
		} catch {
			// Some migrations may reference columns from skipped migrations; ignore
		}
	}

	return db;
}

/** Inserts sample project, worktree, and workspace data into the database. */
function insertTestData(db: Database) {
	db.run(`
		INSERT INTO projects (id, main_repo_path, name, color, tab_order, last_opened_at, created_at)
		VALUES ('proj-1', '/home/user/my-repo', 'My Project', '#3b82f6', 0, 1700000000000, 1700000000000)
	`);
	db.run(`
		INSERT INTO projects (id, main_repo_path, name, color, tab_order, last_opened_at, created_at)
		VALUES ('proj-2', '/home/user/other-repo', 'Other Project', '#ef4444', 1, 1700000000000, 1700000000000)
	`);

	db.run(`
		INSERT INTO worktrees (id, project_id, path, branch, created_at)
		VALUES ('wt-1', 'proj-1', '/home/user/my-repo/.worktrees/feature', 'feature-branch', 1700000000000)
	`);

	// Workspace with a non-UUID id (triggers the UUID migration)
	db.run(`
		INSERT INTO workspaces (id, project_id, worktree_id, type, branch, name, tab_order, created_at, updated_at, last_opened_at)
		VALUES ('ws-non-uuid', 'proj-1', 'wt-1', 'worktree', 'feature-branch', 'Feature Branch', 0, 1700000000000, 1700000000000, 1700000000000)
	`);
	// Workspace with a valid UUID v4 id (should NOT be migrated)
	db.run(`
		INSERT INTO workspaces (id, project_id, type, branch, name, tab_order, created_at, updated_at, last_opened_at)
		VALUES ('550e8400-e29b-41d4-a716-446655440000', 'proj-2', 'branch', 'main', 'Main', 0, 1700000000000, 1700000000000, 1700000000000)
	`);

	// Settings with last_active_workspace_id pointing to the non-UUID workspace
	db.run(`
		INSERT INTO settings (id, last_active_workspace_id)
		VALUES (1, 'ws-non-uuid')
	`);
}

/** The new migrations introduced in 1.3.x (0030–0037). */
const UPGRADE_MIGRATIONS = [
	"0030_shallow_the_leader",
	"0031_add_open_links_in_app_setting",
	"0032_migrate_workspace_ids_to_uuid_v4",
	"0033_nosy_overlord",
	"0034_add_use_compact_terminal_add_button_setting",
	"0035_add_workspace_sections",
	"0036_add_agent_settings",
	"0037_add_created_by_superset_to_worktrees",
];

describe("issue #2784: upgrade from 1.2.4 to 1.3.x preserves repos/workspaces", () => {
	test("migration 0032 (pure SQL) succeeds without custom SQLite functions", () => {
		const db = createPreUpgradeDb();
		insertTestData(db);

		// Run ALL upgrade migrations in a single transaction (like Drizzle does)
		db.run("BEGIN");
		for (const tag of UPGRADE_MIGRATIONS) {
			runMigration(db, tag);
		}
		db.run("COMMIT");

		// Verify projects are still visible (tabOrder is NOT null)
		const projects = db
			.query("SELECT * FROM projects WHERE tab_order IS NOT NULL")
			.all() as { id: string; tab_order: number }[];
		expect(projects).toHaveLength(2);

		// Verify worktrees have the new created_by_superset column
		const worktrees = db.query("SELECT * FROM worktrees").all() as {
			id: string;
			created_by_superset: number;
		}[];
		expect(worktrees).toHaveLength(1);
		expect(worktrees[0].created_by_superset).toBe(1); // DEFAULT true

		// Verify workspace_sections table exists and is queryable
		const sections = db.query("SELECT * FROM workspace_sections").all();
		expect(sections).toHaveLength(0); // No sections yet, but table exists

		// Verify workspaces still exist and the non-UUID was migrated
		const workspaces = db.query("SELECT * FROM workspaces").all() as {
			id: string;
			section_id: string | null;
		}[];
		expect(workspaces).toHaveLength(2);

		// The non-UUID workspace should have been migrated to a UUID v4
		const nonUuidWs = workspaces.find((ws) => ws.id !== "550e8400-e29b-41d4-a716-446655440000");
		expect(nonUuidWs).toBeDefined();
		// Verify the new ID looks like a UUID (36 chars with dashes)
		expect(nonUuidWs!.id).toHaveLength(36);
		expect(nonUuidWs!.id[14]).toBe("4"); // UUID v4 version nibble

		// The UUID v4 workspace should be unchanged
		const uuidWs = workspaces.find((ws) => ws.id === "550e8400-e29b-41d4-a716-446655440000");
		expect(uuidWs).toBeDefined();

		// Settings should have updated last_active_workspace_id
		const settings = db.query("SELECT * FROM settings").all() as {
			last_active_workspace_id: string;
		}[];
		expect(settings[0].last_active_workspace_id).toBe(nonUuidWs!.id);

		db.close();
	});

	test("queries using 1.3.x schema columns succeed after migration", () => {
		const db = createPreUpgradeDb();
		insertTestData(db);

		// Run upgrade migrations
		db.run("BEGIN");
		for (const tag of UPGRADE_MIGRATIONS) {
			runMigration(db, tag);
		}
		db.run("COMMIT");

		// These are the exact queries getAllGrouped runs — they must not throw
		const activeProjects = db
			.query(
				`SELECT id, main_repo_path, name, color, tab_order, worktree_base_dir,
				        hide_image, icon_url, neon_project_id, default_app, github_owner
				 FROM projects WHERE tab_order IS NOT NULL`,
			)
			.all() as { id: string }[];
		expect(activeProjects).toHaveLength(2);

		const allWorktrees = db
			.query(
				`SELECT id, project_id, path, branch, base_branch, created_at,
				        git_status, github_status, created_by_superset
				 FROM worktrees`,
			)
			.all();
		expect(allWorktrees).toHaveLength(1);

		const allSections = db.query("SELECT * FROM workspace_sections").all();
		expect(allSections).toHaveLength(0);

		const allWorkspaces = db
			.query(
				`SELECT id, project_id, worktree_id, type, branch, name, tab_order,
				        created_at, updated_at, last_opened_at, is_unread, is_unnamed,
				        deleting_at, port_base, section_id
				 FROM workspaces WHERE deleting_at IS NULL`,
			)
			.all();
		expect(allWorkspaces).toHaveLength(2);

		db.close();
	});

	test("when migration fails, queries for new columns break (demonstrates the original bug)", () => {
		const db = createPreUpgradeDb();
		insertTestData(db);

		// Simulate a failed migration: run only 0030-0031, skip the rest
		// (as if 0032 failed and everything was rolled back)
		// This demonstrates what happens when the DB has the OLD schema

		// Query for a column added in 0030 (worktree_base_dir) — should fail
		expect(() => {
			db.query(
				"SELECT worktree_base_dir FROM projects",
			).all();
		}).toThrow();

		// Query for workspace_sections table — should fail
		expect(() => {
			db.query("SELECT * FROM workspace_sections").all();
		}).toThrow();

		// Query for created_by_superset column — should fail
		expect(() => {
			db.query(
				"SELECT created_by_superset FROM worktrees",
			).all();
		}).toThrow();

		db.close();
	});

	test("migration 0032 correctly identifies and migrates non-UUID-v4 IDs", () => {
		const db = createPreUpgradeDb();

		// Insert workspaces with various ID formats
		db.run(`
			INSERT INTO projects (id, main_repo_path, name, color, tab_order, last_opened_at, created_at)
			VALUES ('proj-test', '/test', 'Test', 'red', 0, 1700000000000, 1700000000000)
		`);

		// Create a worktree for each test workspace so we can use type='worktree'
		// (avoids the unique partial index on branch workspaces per project)
		const testIds = [
			{ id: "simple-string", wtId: "wt-a", shouldMigrate: true },
			{ id: "12345", wtId: "wt-b", shouldMigrate: true },
			// Valid UUID v4 — should NOT be migrated
			{ id: "550e8400-e29b-41d4-a716-446655440000", wtId: "wt-c", shouldMigrate: false },
			// UUID v1 — should be migrated (not v4)
			{ id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8", wtId: "wt-d", shouldMigrate: true },
		];

		for (const { id, wtId } of testIds) {
			db.run(
				`INSERT INTO worktrees (id, project_id, path, branch, created_at)
				 VALUES (?, 'proj-test', '/test/' || ?, 'branch-' || ?, 1700000000000)`,
				[wtId, wtId, wtId],
			);
			db.run(
				`INSERT INTO workspaces (id, project_id, worktree_id, type, branch, name, tab_order, created_at, updated_at, last_opened_at)
				 VALUES (?, 'proj-test', ?, 'worktree', 'branch-' || ?, 'test', 0, 1700000000000, 1700000000000, 1700000000000)`,
				[id, wtId, wtId],
			);
		}

		// Run upgrade migrations
		db.run("BEGIN");
		for (const tag of UPGRADE_MIGRATIONS) {
			runMigration(db, tag);
		}
		db.run("COMMIT");

		const workspaces = db.query("SELECT id FROM workspaces").all() as {
			id: string;
		}[];

		// The valid UUID v4 should remain unchanged
		expect(workspaces.some((ws) => ws.id === "550e8400-e29b-41d4-a716-446655440000")).toBe(true);

		// All non-v4 IDs should have been replaced with new UUID v4 values
		for (const { id, shouldMigrate } of testIds) {
			if (shouldMigrate) {
				expect(workspaces.some((ws) => ws.id === id)).toBe(false);
			}
		}

		// All workspace IDs should now be valid UUID v4 format
		for (const ws of workspaces) {
			expect(ws.id).toHaveLength(36);
			expect(ws.id[14]).toBe("4"); // version nibble
			expect("89ab").toContain(ws.id[19].toLowerCase()); // variant nibble
		}

		db.close();
	});
});
