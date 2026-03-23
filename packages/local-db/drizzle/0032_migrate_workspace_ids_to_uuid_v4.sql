-- Migrate non-UUID workspace IDs to valid UUIDs.
-- Uses pure SQL so the migration works without custom SQLite functions.
-- A valid UUID v4 has the format: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx

CREATE TABLE IF NOT EXISTS _workspace_id_map (
	old_id TEXT PRIMARY KEY,
	new_id TEXT NOT NULL
);
--> statement-breakpoint

INSERT INTO _workspace_id_map (old_id, new_id)
SELECT id,
	lower(
		hex(randomblob(4)) || '-' ||
		substr(hex(randomblob(2)), 1, 4) || '-' ||
		'4' || substr(hex(randomblob(2)), 2, 3) || '-' ||
		substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2, 3) || '-' ||
		hex(randomblob(6))
	)
FROM workspaces
WHERE NOT (
	length(id) = 36
	AND substr(id, 9, 1) = '-'
	AND substr(id, 14, 1) = '-'
	AND substr(id, 15, 1) = '4'
	AND substr(id, 19, 1) = '-'
	AND lower(substr(id, 20, 1)) IN ('8', '9', 'a', 'b')
	AND substr(id, 24, 1) = '-'
);
--> statement-breakpoint

UPDATE settings
SET last_active_workspace_id = (
	SELECT new_id FROM _workspace_id_map
	WHERE old_id = settings.last_active_workspace_id
)
WHERE last_active_workspace_id IN (
	SELECT old_id FROM _workspace_id_map
);
--> statement-breakpoint

UPDATE workspaces
SET id = (
	SELECT new_id FROM _workspace_id_map
	WHERE old_id = workspaces.id
)
WHERE id IN (
	SELECT old_id FROM _workspace_id_map
);
--> statement-breakpoint

DROP TABLE IF EXISTS _workspace_id_map;
