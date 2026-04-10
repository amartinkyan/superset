import { createFileRoute } from "@tanstack/react-router";
import { V2WorkspacesHeader } from "./components/V2WorkspacesHeader";
import { V2WorkspacesList } from "./components/V2WorkspacesList";
import { useAccessibleV2Workspaces } from "./hooks/useAccessibleV2Workspaces";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/v2-workspaces/",
)({
	component: V2WorkspacesPage,
});

function V2WorkspacesPage() {
	const { pinned, others, counts } = useAccessibleV2Workspaces();
	const hasAnyAccessible = pinned.length > 0 || others.length > 0;

	return (
		<div className="flex h-full w-full flex-1 flex-col overflow-hidden">
			<V2WorkspacesHeader counts={counts} />
			<V2WorkspacesList
				pinned={pinned}
				others={others}
				hasAnyAccessible={hasAnyAccessible}
			/>
		</div>
	);
}
