import type { ElectronRouterOutputs } from "renderer/lib/electron-trpc";

type Project = ElectronRouterOutputs["projects"]["get"];

interface OpenProjectsAndEnsureWorkspacesOptions {
	openNew: () => Promise<Project[]>;
	openMainRepoWorkspace: (input: { projectId: string }) => Promise<unknown>;
	onProjectError?: (project: Project, error: unknown) => void;
}

/**
 * Opens new projects via the file picker and creates a main-repo workspace
 * for each imported project so it appears in the sidebar immediately.
 *
 * Shared between the sidebar footer and the new-workspace modal import flows.
 */
export async function openProjectsAndEnsureWorkspaces({
	openNew,
	openMainRepoWorkspace,
	onProjectError,
}: OpenProjectsAndEnsureWorkspacesOptions): Promise<Project[]> {
	const projects = await openNew();

	for (const project of projects) {
		try {
			await openMainRepoWorkspace({ projectId: project.id });
		} catch (error) {
			onProjectError?.(project, error);
		}
	}

	return projects;
}
