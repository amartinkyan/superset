import { useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";

export interface V2ProjectListItem {
	id: string;
	name: string;
	githubOwner: string | null;
	githubRepoName: string | null;
}

export function useV2ProjectList(): V2ProjectListItem[] | undefined {
	const collections = useCollections();

	const { data: v2Projects } = useLiveQuery(
		(q) =>
			q.from({ projects: collections.v2Projects }).select(({ projects }) => ({
				id: projects.id,
				name: projects.name,
				githubRepositoryId: projects.githubRepositoryId,
			})),
		[collections],
	);

	const { data: githubRepositories } = useLiveQuery(
		(q) =>
			q.from({ repos: collections.githubRepositories }).select(({ repos }) => ({
				id: repos.id,
				owner: repos.owner,
				name: repos.name,
			})),
		[collections],
	);

	return useMemo(() => {
		if (!v2Projects) return undefined;
		const repoById = new Map((githubRepositories ?? []).map((r) => [r.id, r]));
		return v2Projects.map((project) => {
			const repo = project.githubRepositoryId
				? (repoById.get(project.githubRepositoryId) ?? null)
				: null;
			return {
				id: project.id,
				name: project.name,
				githubOwner: repo?.owner ?? null,
				githubRepoName: repo?.name ?? null,
			};
		});
	}, [v2Projects, githubRepositories]);
}
