ALTER TABLE `workspaces` ADD `init_phase` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `init_progress` integer;